//go:build !windows

package procgroup

import (
	"errors"
	"os/exec"
	"syscall"
)

// configure уводит процесс в собственную группу.
//
// Без этого он остаётся в группе вызывающего, и сигнал группе прилетел бы нам
// же. Со своей группой можно снять всё дерево одним сигналом по отрицательному
// идентификатору.
func configure(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// adopt на Unix ничего не делает: группа создана ещё при запуске.
func adopt(cmd *exec.Cmd) (func(), error) {
	if cmd.Process == nil {
		return func() {}, errors.New("процесс не запущен")
	}
	return func() {}, nil
}

func signalGroup(cmd *exec.Cmd, sig syscall.Signal) error {
	if cmd.Process == nil {
		return errors.New("процесс не запущен")
	}
	// Отрицательный идентификатор — это вся группа. Группа совпадает с pid
	// потому, что процесс её и создал.
	err := syscall.Kill(-cmd.Process.Pid, sig)

	// Некого снимать — дерево уже завершилось. Это успех, а не ошибка: так
	// бывает всякий раз, когда мягкая остановка сработала быстрее, чем до
	// группы дошла очередь на принудительную.
	//
	// Linux сообщает об этом как ESRCH, macOS — как EPERM. Прав у нас тут
	// хватает по определению: группу создал наш же потомок, — поэтому EPERM
	// здесь означает не «нельзя», а «уже некому».
	if errors.Is(err, syscall.ESRCH) || errors.Is(err, syscall.EPERM) {
		return nil
	}
	return err
}

func terminate(cmd *exec.Cmd) error { return signalGroup(cmd, syscall.SIGTERM) }

func kill(cmd *exec.Cmd) error { return signalGroup(cmd, syscall.SIGKILL) }
