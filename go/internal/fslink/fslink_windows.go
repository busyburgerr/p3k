//go:build windows

package fslink

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// На Windows обычная символическая ссылка требует особого права, которого у
// обычной учётной записи нет. Каталожная связь (junction) прав не требует и
// для нашей задачи ничем не хуже: она указывает на каталог, её видно как
// каталог, и снимается она отдельно от цели.
//
// Стандартная библиотека умеет такие связи читать и удалять, но не создавать,
// поэтому точку повторного разбора приходится записывать самим.

const (
	fsctlSetReparsePoint    = 0x000900A4
	ioReparseTagMountPoint  = 0xA0000003
	fileFlagOpenReparse     = 0x00200000
	fileFlagBackupSemantics = 0x02000000
)

func makeLink(target, link string) error {
	abs, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	// Каталожная связь — это каталог с особой пометкой, поэтому его сначала
	// нужно создать обычным образом.
	if err := os.Mkdir(link, 0o755); err != nil {
		return err
	}

	if err := setReparsePoint(link, abs); err != nil {
		os.Remove(link)
		return fmt.Errorf("не создали связь %s → %s: %w", link, abs, err)
	}
	return nil
}

func setReparsePoint(link, target string) error {
	// \??\ — путь в терминах диспетчера объектов ядра, именно его ждёт ядро
	// в имени-подстановке.
	substitute, err := syscall.UTF16FromString(`\??\` + target)
	if err != nil {
		return err
	}
	// Печатное имя показывают человеку — например, в выводе dir.
	printed, err := syscall.UTF16FromString(target)
	if err != nil {
		return err
	}
	// UTF16FromString дописывает завершающий ноль; длины в структуре считаются
	// без него, а сам ноль в буфере остаётся.
	subLen := (len(substitute) - 1) * 2
	printLen := (len(printed) - 1) * 2
	pathBytes := (len(substitute) + len(printed)) * 2

	buf := make([]byte, 16+pathBytes)
	binary.LittleEndian.PutUint32(buf[0:], ioReparseTagMountPoint)
	binary.LittleEndian.PutUint16(buf[4:], uint16(8+pathBytes)) // длина данных после заголовка
	binary.LittleEndian.PutUint16(buf[6:], 0)                   // Reserved
	binary.LittleEndian.PutUint16(buf[8:], 0)                   // SubstituteNameOffset
	binary.LittleEndian.PutUint16(buf[10:], uint16(subLen))
	binary.LittleEndian.PutUint16(buf[12:], uint16(subLen+2)) // PrintNameOffset
	binary.LittleEndian.PutUint16(buf[14:], uint16(printLen))

	at := 16
	for _, c := range substitute {
		binary.LittleEndian.PutUint16(buf[at:], c)
		at += 2
	}
	for _, c := range printed {
		binary.LittleEndian.PutUint16(buf[at:], c)
		at += 2
	}

	path, err := syscall.UTF16PtrFromString(link)
	if err != nil {
		return err
	}
	handle, err := syscall.CreateFile(
		path,
		syscall.GENERIC_WRITE,
		0,
		nil,
		syscall.OPEN_EXISTING,
		fileFlagOpenReparse|fileFlagBackupSemantics,
		0,
	)
	if err != nil {
		return err
	}
	defer syscall.CloseHandle(handle)

	var returned uint32
	return syscall.DeviceIoControl(
		handle,
		fsctlSetReparsePoint,
		&buf[0],
		uint32(len(buf)),
		nil,
		0,
		&returned,
		nil,
	)
}

func readLink(link string) (string, error) {
	target, err := os.Readlink(link)
	if err != nil {
		return "", err
	}
	// Стандартная библиотека отдаёт имя-подстановку как есть; человеку и всем
	// остальным нужен обычный путь.
	return trimPrefix(target), nil
}

func trimPrefix(path string) string {
	for _, prefix := range []string{`\??\`, `\\?\`} {
		if len(path) > len(prefix) && path[:len(prefix)] == prefix {
			return path[len(prefix):]
		}
	}
	return path
}

func removeLink(link string) error {
	// Каталожная связь снимается как каталог: содержимое цели при этом не
	// затрагивается — ядро удаляет только саму пометку.
	if err := os.Remove(link); err != nil {
		return err
	}
	return nil
}

func linkExists(link string) bool {
	_, err := os.Lstat(link)
	return err == nil
}
