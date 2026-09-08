//go:build windows

package procgroup

import (
	"errors"
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"
)

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObject          = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject       = kernel32.NewProc("TerminateJobObject")
	procGenerateConsoleCtrlEvent = kernel32.NewProc("GenerateConsoleCtrlEvent")
)

const (
	jobObjectExtendedLimitInformation = 9
	// Ядро снимет всё задание, как только закроется последний его дескриптор.
	// Ради этого флага всё и затевалось: даже если нас сняли принудительно и
	// ни один наш обработчик не отработал, дерево не переживёт нас.
	jobObjectLimitKillOnJobClose = 0x00002000

	createNewProcessGroup = 0x00000200
	ctrlBreakEvent        = 1

	processTerminate = 0x0001
	processSetQuota  = 0x0100
)

type jobBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobExtendedLimitInformation struct {
	BasicLimitInformation jobBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

var (
	mu   sync.Mutex
	jobs = map[*exec.Cmd]syscall.Handle{}
)

// configure уводит процесс в собственную группу.
//
// Без этого сигнал по Ctrl+Break ушёл бы и нам самим: консольные события
// приходят всей группе. Со своей группой мы можем позвать дерево завершиться,
// не сняв заодно себя.
func configure(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= createNewProcessGroup
}

// adopt заводит объект задания и помещает в него запущенный процесс.
//
// Между запуском и помещением есть зазор в доли миллисекунды: успей процесс
// за это время породить потомка, тот в задание не попадёт. Правильное лекарство
// — запускать приостановленным, но os/exec не отдаёт наружу дескриптор потока,
// чтобы его возобновить. На практике за это время не успевает никто.
func adopt(cmd *exec.Cmd) (func(), error) {
	noop := func() {}
	if cmd.Process == nil {
		return noop, errors.New("процесс не запущен")
	}

	handle, _, err := procCreateJobObject.Call(0, 0)
	if handle == 0 {
		return noop, fmt.Errorf("не создали объект задания: %w", err)
	}
	job := syscall.Handle(handle)

	var limits jobExtendedLimitInformation
	limits.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	ok, _, err := procSetInformationJobObject.Call(
		uintptr(job),
		jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)),
		unsafe.Sizeof(limits),
	)
	if ok == 0 {
		syscall.CloseHandle(job)
		return noop, fmt.Errorf("не задали правила задания: %w", err)
	}

	proc, err := syscall.OpenProcess(processSetQuota|processTerminate, false, uint32(cmd.Process.Pid))
	if err != nil {
		syscall.CloseHandle(job)
		return noop, fmt.Errorf("не открыли процесс %d: %w", cmd.Process.Pid, err)
	}
	ok, _, err = procAssignProcessToJobObject.Call(uintptr(job), uintptr(proc))
	syscall.CloseHandle(proc)
	if ok == 0 {
		syscall.CloseHandle(job)
		return noop, fmt.Errorf("не поместили процесс в задание: %w", err)
	}

	mu.Lock()
	jobs[cmd] = job
	mu.Unlock()

	// Закрытие дескриптора снимает всё задание — в этом и смысл флага.
	// Поэтому освобождать надзор можно только тогда, когда дерево уже не нужно.
	return func() {
		mu.Lock()
		delete(jobs, cmd)
		mu.Unlock()
		syscall.CloseHandle(job)
	}, nil
}

func jobOf(cmd *exec.Cmd) (syscall.Handle, bool) {
	mu.Lock()
	defer mu.Unlock()
	job, ok := jobs[cmd]
	return job, ok
}

// terminate шлёт дереву Ctrl+Break.
//
// Программа, которая его обрабатывает (в Go это os.Interrupt-подобный SIGBREAK,
// в Node — SIGBREAK), завершится по-хорошему. Остальные его проигнорируют,
// поэтому ждать после этого стоит недолго. Если у нас вовсе нет консоли —
// например, программа запущена службой, — послать событие некуда, и тогда
// возвращается ErrNoSoftStop: ждать нечего, нужно сразу снимать.
func terminate(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return errors.New("процесс не запущен")
	}
	ok, _, err := procGenerateConsoleCtrlEvent.Call(ctrlBreakEvent, uintptr(cmd.Process.Pid))
	if ok == 0 {
		return fmt.Errorf("%w: %v", ErrNoSoftStop, err)
	}
	return nil
}

// kill снимает всё задание разом. Потомки, внуки и правнуки уходят вместе.
func kill(cmd *exec.Cmd) error {
	if job, ok := jobOf(cmd); ok {
		if res, _, err := procTerminateJobObject.Call(uintptr(job), 1); res == 0 {
			return fmt.Errorf("не сняли задание: %w", err)
		}
		return nil
	}
	// Задание не завелось — снимаем хотя бы сам процесс.
	if cmd.Process == nil {
		return errors.New("процесс не запущен")
	}
	return cmd.Process.Kill()
}
