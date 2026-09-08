// Пакет shell запускает команды так, как их написал человек.
//
// Команды в конфиге пишут привычно: с кавычками, конвейерами, подстановками.
// Разбирать такую строку самим — значит делать вид, что мы оболочка, и
// расходиться с ней на первом же непростом случае. Поэтому строка уходит
// оболочке целиком.
package shell

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Command собирает команду, не запуская её.
//
// dir и env применяются как обычно: пустой dir означает текущий каталог,
// nil env — окружение процесса как есть.
func Command(ctx context.Context, command, dir string, env []string) *exec.Cmd {
	name, args := parts(command)
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = env
	finalize(cmd, command)
	return cmd
}

// Detached собирает команду, временем жизни которой распоряжается вызывающий.
//
// Отличается от Command тем, что её не снимет контекст. Это нужно для
// долгоживущих процессов окружения: снимать их надо всем деревом и в порядке,
// обратном зависимостям, а не просто убив родителя по отмене контекста.
func Detached(command, dir string, env []string) *exec.Cmd {
	name, args := parts(command)
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = env
	finalize(cmd, command)
	return cmd
}

func parts(command string) (string, []string) {
	if runtime.GOOS == "windows" {
		shell := os.Getenv("COMSPEC")
		if shell == "" {
			shell = "cmd.exe"
		}
		return shell, []string{"/d", "/s", "/c", command}
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	return shell, []string{"-c", command}
}

// Result — что осталось от выполненной команды.
type Result struct {
	Stdout string
	Stderr string
	Code   int
	// OK — команда завершилась с нулём.
	OK bool
}

// Output — то, что команда напечатала: сначала stderr, потому что причина
// обычно там. Пустые куски не склеиваются пустыми строками.
func (r Result) Output() string {
	parts := make([]string, 0, 2)
	for _, s := range []string{r.Stderr, r.Stdout} {
		if t := strings.TrimSpace(s); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n")
}

// Tail — последние n строк вывода. Их обычно достаточно, чтобы понять причину,
// а полный вывод сборки в сообщении об ошибке только мешает.
func (r Result) Tail(n int) string {
	lines := strings.Split(r.Output(), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// Run выполняет команду и дожидается её.
//
// Ненулевой код возврата — это не ошибка Go, а результат: он приходит в
// Result.Code. Ошибка возвращается, только если команду не удалось запустить
// вовсе или прервали контекст.
func Run(ctx context.Context, command, dir string, env []string) (Result, error) {
	cmd := Command(ctx, command, dir, env)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	res := Result{Stdout: stdout.String(), Stderr: stderr.String()}

	var exitErr *exec.ExitError
	switch {
	case err == nil:
		res.OK = true
	case asExitError(err, &exitErr):
		res.Code = exitErr.ExitCode()
	default:
		return res, err
	}
	return res, nil
}

// Succeeds — короткий ответ на вопрос «команда отработала успешно?».
// Невозможность запустить команду тоже означает «нет».
func Succeeds(ctx context.Context, command, dir string, env []string) bool {
	res, err := Run(ctx, command, dir, env)
	return err == nil && res.OK
}

func asExitError(err error, target **exec.ExitError) bool {
	e, ok := err.(*exec.ExitError)
	if ok {
		*target = e
	}
	return ok
}
