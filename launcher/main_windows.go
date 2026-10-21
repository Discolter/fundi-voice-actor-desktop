//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

const createNoWindow = 0x08000000

func message(text string, flags uintptr) {
	title, _ := syscall.UTF16PtrFromString("Fundi Voice Actor")
	body, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), flags)
}
func running() bool {
	name, _ := syscall.UTF16PtrFromString(`Local\FundiVoiceActor-` + os.Getenv("USERNAME"))
	kernel := syscall.NewLazyDLL("kernel32.dll")
	handle, _, _ := kernel.NewProc("OpenMutexW").Call(0x00100000, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return false
	}
	kernel.NewProc("CloseHandle").Call(handle)
	return true
}
func launch(dir string) error {
	script := filepath.Join(dir, "Launch.ps1")
	if _, err := os.Stat(script); err != nil {
		return fmt.Errorf("Не найден Launch.ps1: %w", err)
	}
	powershell := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	cmd := exec.Command(powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
func logEvent(err error) {
	if err == nil {
		return
	}
	dataDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "FundiVoiceActor")
	_ = os.MkdirAll(dataDir, 0700)
	f, e := os.OpenFile(filepath.Join(dataDir, "actor-launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if e == nil {
		_, _ = fmt.Fprintln(f, err)
		_ = f.Close()
	}
}

// Show at most three earlier versions; rollback never deletes any account or recordings.
func rollback(root string) {
	if running() {
		message("Закрой Actor через меню у часов Windows перед откатом.", 0x30)
		return
	}
	current, _ := currentVersion(root)
	older := previousVersions(root, current)
	if len(older) == 0 {
		message("Пока нет предыдущих установленных версий Actor для отката.", 0x40)
		return
	}
	for _, v := range older {
		choice := question("Откатить Actor с версии " + current + " на " + v + "?\n\nДа — выбрать эту версию. Нет — показать следующую. Отмена — выйти.")
		if choice == 2 {
			return
		}
		if choice != 6 {
			continue
		}
		if err := writeCurrentVersion(root, v); err != nil {
			message("Не удалось выбрать версию: "+err.Error(), 0x10)
			return
		}
		// Manual rollback blocks the same newest release from immediately reinstalling on the next launch.
		_ = os.WriteFile(filepath.Join(root, "skip-version.txt"), []byte(current+"\n"), 0600)
		if err := launch(filepath.Join(root, "versions", v)); err != nil {
			_ = writeCurrentVersion(root, current)
			_ = os.Remove(filepath.Join(root, "skip-version.txt"))
			logEvent(fmt.Errorf("manual rollback: %w", err))
			message("Не удалось запустить предыдущую версию: "+err.Error(), 0x10)
		} else {
			message("Выбрана версия "+v+". Обновление до "+current+" временно пропускается. Личные данные сохранены.", 0x40)
		}
		return
	}
}
func question(text string) uintptr {
	title, _ := syscall.UTF16PtrFromString("Fundi Voice Actor — откат версии")
	body, _ := syscall.UTF16PtrFromString(text)
	r, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x00000003|0x00000040|0x00010000)
	// MB_YESNOCANCEL is 0x3: IDYES=6 / IDNO=7 / IDCANCEL=2.
	return r
}
func waitHealthy(max time.Duration) bool {
	until := time.Now().Add(max)
	for time.Now().Before(until) {
		if running() {
			return true
		}
		time.Sleep(400 * time.Millisecond)
	}
	return false
}
func main() {
	// Prevent two launcher windows from racing over the update cache and version pointer.
	mutexName, _ := syscall.UTF16PtrFromString(`Local\FundiVoiceActorUpdater-` + os.Getenv("USERNAME"))
	mutex, _, lastErr := syscall.NewLazyDLL("kernel32.dll").NewProc("CreateMutexW").Call(0, 0, uintptr(unsafe.Pointer(mutexName)))
	if mutex == 0 {
		message("Не удалось открыть механизм обновления.", 0x10)
		return
	}
	defer syscall.NewLazyDLL("kernel32.dll").NewProc("CloseHandle").Call(mutex)
	if lastErr == syscall.Errno(183) {
		message("Проверка обновления Actor уже выполняется.", 0x40)
		return
	}
	exe, err := os.Executable()
	if err != nil {
		message("Не удалось определить путь лаунчера.", 0x10)
		return
	}
	root := filepath.Dir(exe)
	if len(os.Args) == 2 && os.Args[1] == "--rollback" {
		rollback(root)
		return
	}
	if running() {
		message("Actor уже запущен. Закрой приложение через значок у часов Windows, затем запусти лаунчер снова для обновления.", 0x40)
		return
	}
	previous, initialDir := currentVersion(root)
	if previous == "" || initialDir == "" {
		message("Установленные файлы Actor не найдены. Переустанови лаунчер.", 0x10)
		return
	}
	updated, updateError := checkAndUpdate(root)
	if updateError != nil {
		logEvent(fmt.Errorf("Update check: %s", updateError.Error()))
	}
	current, dir := currentVersion(root)
	err = launch(dir)
	if err == nil {
		// An Actor host mutex is created only after its local server is initialized.
		healthy := false
		for i := 0; i < 120; i++ {
			if running() {
				healthy = true
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
		if !healthy {
			err = fmt.Errorf("Actor did not start successfully: %s", current)
		}
	}
	if err != nil {
		logEvent(fmt.Errorf("Actor startup %s: %w", current, err))
		// Don't leave a new failing version selected. Keep all old account data untouched.
		if updated && previous != "" && previous != current {
			_ = os.WriteFile(filepath.Join(root, "bad-version.txt"), []byte(current+"\n"), 0600)
			if setErr := writeCurrentVersion(root, previous); setErr == nil {
				if launch(initialDir) == nil {
					message("Обновление не запустилось. Восстановлена предыдущая версия Actor.", 0x30)
					return
				}
			}
		}
		message("Не удалось открыть Actor: "+err.Error()+"\n\nЛичные данные не удалены. Подробности в actor-launcher.log.", 0x10)
		return
	}
	// Prune only after a confirmed healthy startup, never before.
	if err = pruneVersions(root, current); err != nil {
		logEvent(fmt.Errorf("Version cleanup: %w", err))
	}
}
