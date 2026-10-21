// Per-user uninstaller. Removes application files and shortcuts, never user workspace or cloud secrets.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const title = "Fundi Voice Actor — удаление"
const createNoWindow = 0x08000000
const uninstallKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\FundiVoiceActor`
const yesNoQuestion = 0x00000004 | 0x00000020 | 0x00010000
const retryCancel = 0x00000005 | 0x00000030 | 0x00010000

func dialog(text string, flags uintptr) uintptr {
	pTitle, _ := syscall.UTF16PtrFromString(title)
	pText, _ := syscall.UTF16PtrFromString(text)
	r, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(pText)), uintptr(unsafe.Pointer(pTitle)), flags)
	return r
}
func psQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", "''") + "'" }
func runQuiet(path string, args ...string) error {
	cmd := exec.Command(path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd.Run()
}
func psExe() string {
	return filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}
func isActorRunning() bool {
	name, _ := syscall.UTF16PtrFromString(`Local\FundiVoiceActor-` + os.Getenv("USERNAME"))
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("OpenMutexW")
	r, _, _ := proc.Call(0x00100000, 0, uintptr(unsafe.Pointer(name)))
	if r == 0 {
		return false
	}
	syscall.NewLazyDLL("kernel32.dll").NewProc("CloseHandle").Call(r)
	return true
}
func main() {
	exe, err := os.Executable()
	if err != nil {
		dialog("Не удалось определить путь программы.", 0x10)
		return
	}
	dir := filepath.Dir(exe)
	// Never recursively delete an arbitrary folder via an untrusted command argument.
	if filepath.Base(dir) != "Fundi Voice Actor" {
		dialog("Папка установки выглядит необычно. Для безопасности удаление отменено.", 0x10)
		return
	}
	if _, err := os.Stat(filepath.Join(dir, "FundiVoiceActor.exe")); err != nil {
		dialog("Файлы Actor не найдены. Удаление отменено.", 0x10)
		return
	}
	if dialog("Удалить Fundi Voice Actor с этого компьютера?\n\nАккаунт, роли, настройки и ключи доступа останутся в %LOCALAPPDATA%\\FundiVoiceActor.\nУдаляются только файлы приложения и ярлыки.", yesNoQuestion) != 6 {
		return
	}
	for isActorRunning() {
		if dialog("Fundi Voice Actor ещё запущена.\n\nОткройте Настройки → Завершить приложение или выберите Выход на значке возле часов Windows. Затем нажмите «Повторить».", retryCancel) != 4 {
			return
		}
	}
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$target = %s
$w = New-Object -ComObject WScript.Shell
$items = @([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Fundi Voice Actor.lnk'),[IO.Path]::Combine([Environment]::GetFolderPath('Programs'),'Fundi Voice Actor','Fundi Voice Actor.lnk'),[IO.Path]::Combine([Environment]::GetFolderPath('Programs'),'Fundi Voice Actor','Fundi Voice Actor - Откат версии.lnk'))
foreach ($s in $items) {
  if (Test-Path -LiteralPath $s) {
    try { if ($w.CreateShortcut($s).TargetPath -ieq [IO.Path]::Combine($target,'FundiVoiceActor.exe')) { Remove-Item -LiteralPath $s -Force } } catch {}
  }
}
`, psQuote(dir))
	tempScript, err := os.CreateTemp("", "fundi-remove-shortcuts-*.ps1")
	if err == nil {
		_, _ = tempScript.WriteString(script)
		_ = tempScript.Close()
		_ = runQuiet(psExe(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tempScript.Name())
		_ = os.Remove(tempScript.Name())
	}
	_ = runQuiet("reg.exe", "DELETE", uninstallKey, "/f")
	cleanup := fmt.Sprintf(`$target = %s
for ($i=0; $i -lt 30; $i++) {
  try { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop; break }
  catch { Start-Sleep -Milliseconds 700 }
}
Start-Sleep -Milliseconds 150
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`, psQuote(dir))
	tempCleanup, err := os.CreateTemp("", "fundi-cleanup-*.ps1")
	if err != nil {
		dialog("Не удалось подготовить удаление: "+err.Error(), 0x10)
		return
	}
	_, err = tempCleanup.WriteString(cleanup)
	_ = tempCleanup.Close()
	if err != nil {
		dialog("Ошибка подготовки удаления: "+err.Error(), 0x10)
		return
	}
	cmd := exec.Command(psExe(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", tempCleanup.Name())
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err = cmd.Start(); err != nil {
		dialog("Не удалось завершить удаление: "+err.Error(), 0x10)
		return
	}
	_ = cmd.Process.Release()
	dialog("Удаление запущено. Файлы программы будут удалены после закрытия этого окна.\n\nВаши проекты и настройки сохранены.", 0x40)
}
