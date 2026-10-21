//go:build windows

// Fundi Voice Actor self-contained, per-user Windows setup/upgrade executable.
package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"unsafe"
)

//go:embed payload.zip
var payload []byte

var version = "0.4.0" // Build-time value supplied by -ldflags
const appName = "Fundi Voice Actor"
const uninstallKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\FundiVoiceActor`
const createNoWindow = 0x08000000
const mbYesNoInfo = 0x00000004 | 0x00000040 | 0x00010000
const mbRetryCancelWarning = 0x00000005 | 0x00000030 | 0x00010000
const mbError = 0x00000010
const mbInformation = 0x00000040

func dialog(title, message string, flags uintptr) uintptr {
	pTitle, _ := syscall.UTF16PtrFromString(title)
	pMsg, _ := syscall.UTF16PtrFromString(message)
	r, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(pMsg)), uintptr(unsafe.Pointer(pTitle)), flags)
	return r
}
func psQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", "''") + "'" }
func runQuiet(path string, args ...string) error {
	cmd := exec.Command(path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w (%s)", filepath.Base(path), err, strings.TrimSpace(string(output)))
	}
	return nil
}
func powershell() string {
	return filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}
func isActorRunning() bool {
	name, _ := syscall.UTF16PtrFromString(`Local\FundiVoiceActor-` + os.Getenv("USERNAME"))
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("OpenMutexW")
	handle, _, _ := proc.Call(0x00100000, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return false
	}
	syscall.NewLazyDLL("kernel32.dll").NewProc("CloseHandle").Call(handle)
	return true
}
func extractInto(dest string) error {
	z, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("Не удалось прочитать файлы установщика: %w", err)
	}
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		// Reject any absolute or traversal paths even if someone replaces the embedded ZIP.
		name := filepath.FromSlash(f.Name)
		if filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) || strings.Contains(name, ":") {
			return fmt.Errorf("Недопустимый путь в установщике: %q", f.Name)
		}
		target := filepath.Join(dest, name)
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		read, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
		if err != nil {
			_ = read.Close()
			return err
		}
		_, copyErr := io.Copy(out, read)
		closeErr := out.Close()
		_ = read.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

// Compile the current .NET 4.8 application against the user's native Windows
// framework BEFORE replacing the installed version. If compilation fails,
// we abort and the existing application/session remains untouched.
func compileActor(stage string) error {
	// Compile the bundled 0.4.0 release before replacing the prior installed version.
	app := filepath.Join(stage, "versions", version)
	script := filepath.Join(app, "Build-Actor.ps1")
	if _, err := os.Stat(script); err != nil {
		return fmt.Errorf("Actor source absent from setup: %w", err)
	}
	if err := runQuiet(powershell(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script); err != nil {
		// Keep full compiler diagnostics in a local file, not a huge Windows dialog.
		logDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "FundiVoiceActor")
		if os.MkdirAll(logDir, 0700) == nil {
			logPath := filepath.Join(logDir, "actor-installer-build.log")
			if os.WriteFile(logPath, []byte(err.Error()+"\r\n"), 0600) == nil {
				return fmt.Errorf("Не удалось собрать Actor. Старая версия сохранена.\nПодробности: %s", logPath)
			}
		}
		return fmt.Errorf("Не удалось собрать Actor. Старая версия сохранена: %s", filepath.Base(powershell()))
	}
	info, err := os.Stat(filepath.Join(app, "FundiVoiceActor.App.exe"))
	if err != nil || info.Size() < 1024 {
		return fmt.Errorf("Actor compilation produced no executable; old installation untouched")
	}
	return nil
}

// Migrate historical versions without changing LOCALAPPDATA\FundiVoiceActor session data.
// Copy only app-owned directories; do not follow links or touch unrelated folders.
func copyTree(src, dst string) error {
	return filepath.Walk(src, func(p string, info os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("Symlink in old Actor installation: %s", p)
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(dst, 0755)
		}
		out := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(out, 0755)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("Unexpected file: %s", p)
		}
		if err := os.MkdirAll(filepath.Dir(out), 0755); err != nil {
			return err
		}
		from, err := os.Open(p)
		if err != nil {
			return err
		}
		defer from.Close()
		to, err := os.OpenFile(out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, cp := io.Copy(to, from)
		cl := to.Close()
		if cp != nil {
			return cp
		}
		return cl
	})
}
func migrateExisting(dest, stage string) error {
	if _, err := os.Stat(filepath.Join(dest, "FundiVoiceActor.exe")); err != nil {
		return fmt.Errorf("Existing folder does not contain Actor.exe: %w", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "versions")); err == nil {
		items, err := os.ReadDir(filepath.Join(dest, "versions"))
		if err != nil {
			return err
		}
		for _, item := range items {
			if !item.IsDir() || !versionName.MatchString(item.Name()) {
				continue
			}
			target := filepath.Join(stage, "versions", item.Name())
			if _, err := os.Stat(target); err == nil {
				continue
			}
			if err := copyTree(filepath.Join(dest, "versions", item.Name()), target); err != nil {
				return err
			}
		}
		prev, err := os.ReadFile(filepath.Join(dest, "current-version.txt"))
		if err == nil && versionName.MatchString(strings.TrimSpace(string(prev))) {
			selected := strings.TrimSpace(string(prev))
			if _, err := os.Stat(filepath.Join(stage, "versions", selected, "Launch.ps1")); err == nil {
				if err := os.WriteFile(filepath.Join(stage, "current-version.txt"), prev, 0600); err != nil {
					return err
				}
			}
		}
		for _, name := range []string{"bad-version.txt", "skip-version.txt"} {
			if b, err := os.ReadFile(filepath.Join(dest, name)); err == nil && len(b) < 100 {
				_ = os.WriteFile(filepath.Join(stage, name), b, 0600)
			}
		}
		return nil
	}
	// Pre-launcher 0.3.5/0.4.0: keep its executable as the first rollback candidate.
	v := strings.TrimSpace(string(readVersionFile(filepath.Join(dest, "VERSION.txt"))))
	if !versionName.MatchString(v) || v == version {
		return nil
	}
	historical := filepath.Join(stage, "versions", v)
	if err := os.MkdirAll(historical, 0755); err != nil {
		return err
	}
	oldExe := filepath.Join(dest, "FundiVoiceActor.exe")
	f, err := os.Open(oldExe)
	if err != nil {
		return err
	}
	defer f.Close()
	target, err := os.OpenFile(filepath.Join(historical, "FundiVoiceActor.App.exe"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, cp := io.Copy(target, f)
	closeErr := target.Close()
	if cp != nil {
		return cp
	}
	if closeErr != nil {
		return closeErr
	}
	if err := copyTree(filepath.Join(dest, "web"), filepath.Join(historical, "web")); err != nil {
		return err
	}
	_ = os.WriteFile(filepath.Join(historical, "Launch.ps1"), []byte("Start-Process -FilePath (Join-Path $PSScriptRoot 'FundiVoiceActor.App.exe') -WorkingDirectory $PSScriptRoot\r\n"), 0600)
	_ = os.WriteFile(filepath.Join(historical, "VERSION.txt"), []byte(v+"\n"), 0600)
	return nil
}
func readVersionFile(path string) []byte {
	b, _ := os.ReadFile(path)
	if len(b) > 60 {
		return nil
	}
	return b
}

var versionName = regexp.MustCompile(`^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$`)

func installFiles(dest string) error {
	parent := filepath.Dir(dest)
	if err := os.MkdirAll(parent, 0755); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(parent, ".FundiVoiceActor-new-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err = extractInto(stage); err != nil {
		return err
	}
	if err = compileActor(stage); err != nil {
		return err
	}
	if _, err := os.Stat(dest); err == nil {
		if err = migrateExisting(dest, stage); err != nil {
			return err
		}
	}
	_, err = os.Stat(dest)
	wasInstalled := err == nil
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	backup := ""
	if wasInstalled {
		// Protect folders not originally created by this installer.
		if _, err = os.Stat(filepath.Join(dest, "FundiVoiceActor.exe")); err != nil {
			return fmt.Errorf("В папке установки уже находятся другие файлы: %s. Переименуйте папку вручную и повторите установку", dest)
		}
		backup, err = os.MkdirTemp(parent, ".FundiVoiceActor-old-")
		if err != nil {
			return err
		}
		_ = os.Remove(backup)
		if err = os.Rename(dest, backup); err != nil {
			return fmt.Errorf("Не удалось закрыть старую версию или переименовать её папку: %w", err)
		}
	}
	if err = os.Rename(stage, dest); err != nil {
		if backup != "" {
			_ = os.Rename(backup, dest)
		}
		return fmt.Errorf("Не удалось установить новые файлы (старая версия восстановлена, если была): %w", err)
	}
	if backup != "" {
		_ = os.RemoveAll(backup)
	}
	return nil
}
func makeShortcuts(dest string) error {
	target := filepath.Join(dest, "FundiVoiceActor.exe")
	icon := filepath.Join(dest, "favicon.ico")
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$exe = %s
$cwd = %s
$ico = %s
$ws = New-Object -ComObject WScript.Shell
$start = [IO.Path]::Combine([Environment]::GetFolderPath('Programs'),'Fundi Voice Actor')
[IO.Directory]::CreateDirectory($start) | Out-Null
$paths = @([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Fundi Voice Actor.lnk'),[IO.Path]::Combine($start,'Fundi Voice Actor.lnk'))
foreach ($p in $paths) {
  $shortcut = $ws.CreateShortcut($p)
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = $cwd
  $shortcut.IconLocation = $ico
  $shortcut.Description = 'Fundi Voice Actor'
  $shortcut.Save()
}
$recovery = $ws.CreateShortcut([IO.Path]::Combine($start,'Fundi Voice Actor - Откат версии.lnk'))
$recovery.TargetPath=$exe
$recovery.Arguments='--rollback'
$recovery.WorkingDirectory=$cwd
$recovery.IconLocation=$ico
$recovery.Description='Выбрать одну из трёх предыдущих версий Actor'
$recovery.Save()
`, psQuote(target), psQuote(dest), psQuote(icon))
	tmp, err := os.CreateTemp("", "fundi-shortcuts-*.ps1")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	// Windows PowerShell 5 reads unsigned UTF-8 .ps1 as the system ANSI codepage.
	// Add the UTF-8 BOM so localized shortcut labels cannot corrupt the parser.
	if _, err = tmp.WriteString("\ufeff" + script); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return runQuiet(powershell(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tmp.Name())
}
func writeRegistry(dest string) error {
	values := [][3]string{
		{"DisplayName", "REG_SZ", appName},
		{"DisplayVersion", "REG_SZ", version},
		{"Publisher", "REG_SZ", "FundiVoice"},
		{"DisplayIcon", "REG_SZ", filepath.Join(dest, "FundiVoiceActor.exe")},
		{"InstallLocation", "REG_SZ", dest},
		{"UninstallString", "REG_SZ", `"` + filepath.Join(dest, "Uninstall.exe") + `"`},
		{"NoModify", "REG_DWORD", "1"},
		{"NoRepair", "REG_DWORD", "1"},
	}
	for _, v := range values {
		if err := runQuiet("reg.exe", "ADD", uninstallKey, "/v", v[0], "/t", v[1], "/d", v[2], "/f"); err != nil {
			return err
		}
	}
	return nil
}
func main() {
	title := fmt.Sprintf("%s — установка %s", appName, version)
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		dialog(title, "Не удалось определить LOCALAPPDATA текущего пользователя Windows.", mbError)
		return
	}
	dest := filepath.Join(localAppData, "Programs", "Fundi Voice Actor")
	installed := false
	if _, err := os.Stat(filepath.Join(dest, "FundiVoiceActor.exe")); err == nil {
		installed = true
	}
	question := fmt.Sprintf("Установить Fundi Voice Actor %s?\n\nПапка: %s\n\nПосле установки программа запускается с ярлыка или FundiVoiceActor.exe. Все личные данные останутся в %%LOCALAPPDATA%%\\FundiVoiceActor.\n\nПродолжить?", version, dest)
	if installed {
		question = fmt.Sprintf("Обновить Fundi Voice Actor до версии %s поверх установленной программы?\n\nПапка: %s\n\nАккаунт, роли, настройки и записи сохранятся. Удалять прежнюю версию не нужно.\n\nПродолжить?", version, dest)
	}
	if dialog(title, question, mbYesNoInfo) != 6 {
		return
	}
	for isActorRunning() {
		if dialog(title, "Actor сейчас работает, возможно, свёрнут в трей.\n\nНажмите правой кнопкой на значке Actor у часов Windows и выберите «Выход».\n\nЗатем нажмите «Повторить». Данные должны быть сохранены до обновления.", mbRetryCancelWarning) != 4 {
			return
		}
	}
	if err := installFiles(dest); err != nil {
		dialog(title, "Установка не удалась:\n\n"+err.Error(), mbError)
		return
	}
	var warnings []string
	if err := makeShortcuts(dest); err != nil {
		warnings = append(warnings, "Не удалось создать ярлыки: "+err.Error())
	}
	if err := writeRegistry(dest); err != nil {
		warnings = append(warnings, "Не удалось добавить программу в список приложений: "+err.Error())
	}
	if len(warnings) > 0 {
		dialog(title, "Программа установлена, но есть замечания:\n\n"+strings.Join(warnings, "\n\n")+"\n\nВы можете запустить FundiVoiceActor.exe из папки установки.", 0x30)
	}
	done := "Fundi Voice Actor " + version + " успешно установлен!\n\nЯрлык добавлен на рабочий стол и в меню Пуск.\n\nТеперь при каждом запуске программа проверяет обновления в GitHub. В меню Пуск доступен откат на 1-3 версии.\n\nЗапустить программу сейчас?"
	if len(warnings) > 0 {
		done = "Файлы Actor установлены.\n\nЗапустить FundiVoiceActor.exe сейчас?"
	}
	if dialog(title, done, mbYesNoInfo) == 6 {
		launcher := exec.Command(filepath.Join(dest, "FundiVoiceActor.exe"))
		launcher.Dir = dest
		if err := launcher.Start(); err != nil {
			dialog(title, "Не удалось открыть Actor: "+err.Error(), mbError)
		} else {
			_ = launcher.Process.Release()
		}
	}
}
