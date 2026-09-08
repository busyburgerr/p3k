package p3k

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/busyburgerr/p3k/go/internal/fslink"
	"github.com/busyburgerr/p3k/go/internal/shell"
)

// Target — куда выкатывать: сервер по SSH или каталог на этой же машине.
//
// Вся логика выпусков — создать каталог, залить, переключить ссылку, откатить —
// написана поверх этого интерфейса и одинакова для обеих целей. Локальная цель
// не игрушечная: она нужна, чтобы порядок шагов и откат можно было проверить
// целиком, не имея сервера, — и потому проверяется теми же тестами.
//
// Свою цель реализовать можно: например, поверх готового SSH-соединения или
// поверх API вашего облака.
type Target interface {
	// Describe — как назвать цель человеку.
	Describe() string
	// Probe — есть ли связь. Проверяется до сборки: узнавать о недоступном
	// сервере после десяти минут сборки — худший из возможных порядков.
	Probe(ctx context.Context) error
	// Join склеивает пути на стороне цели.
	Join(parts ...string) string
	// Run выполняет команду на цели.
	Run(ctx context.Context, command, dir string) (shell.Result, error)
	Mkdir(ctx context.Context, dir string) error
	// Upload отправляет пути (относительно root) внутрь каталога dest.
	Upload(ctx context.Context, root string, paths []string, dest string) error
	// Link переключает ссылку link на каталог target.
	Link(ctx context.Context, target, link string) error
	// ReadLink возвращает, куда указывает ссылка, или пустую строку.
	ReadLink(ctx context.Context, link string) (string, error)
	List(ctx context.Context, dir string) ([]string, error)
	Remove(ctx context.Context, path string) error
	Exists(ctx context.Context, path string) (bool, error)
}

// quote оборачивает строку для оболочки сервера.
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// SSHTarget — сервер, доступный по ssh.
type SSHTarget struct {
	// Host — user@host.
	Host string
	// Options — дополнительные аргументы ssh: порт, ключ.
	Options []string
}

func (t *SSHTarget) Describe() string {
	if len(t.Options) > 0 {
		return fmt.Sprintf("%s (ssh %s)", t.Host, strings.Join(t.Options, " "))
	}
	return t.Host
}

// args собирает аргументы ssh.
//
// BatchMode: без него ssh при неподошедшем ключе спросит пароль, а спросить
// некого — вывод перехвачен, и команда просто зависнет.
func (t *SSHTarget) args() []string {
	return append(append([]string{"-o", "BatchMode=yes"}, t.Options...), t.Host)
}

func (t *SSHTarget) Join(parts ...string) string {
	joined := strings.Join(parts, "/")
	for strings.Contains(joined, "//") {
		joined = strings.ReplaceAll(joined, "//", "/")
	}
	return joined
}

func (t *SSHTarget) Probe(ctx context.Context) error {
	res, err := t.Run(ctx, "true", "")
	if err != nil {
		return err
	}
	if !res.OK {
		return fmt.Errorf("не достучались до %s: %s\n"+
			"     ssh запускается без пароля (BatchMode) — нужен ключ; проверьте: ssh %s true",
			t.Host, res.Tail(3), t.Host)
	}
	return nil
}

// run запускает внешнюю программу без оболочки.
//
// Команду для сервера собираем сами и передаём одним аргументом: иначе её
// пришлось бы кавычить дважды — под локальную оболочку и под удалённую, — а на
// Windows локальная ещё и другая.
func run(ctx context.Context, name string, args []string, stdin io.Reader) (shell.Result, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = stdin

	var out, errOut strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &errOut

	err := cmd.Run()
	res := shell.Result{Stdout: out.String(), Stderr: errOut.String()}

	var exitErr *exec.ExitError
	switch {
	case err == nil:
		res.OK = true
	case errors.As(err, &exitErr):
		res.Code = exitErr.ExitCode()
	default:
		return res, err
	}
	return res, nil
}

func (t *SSHTarget) Run(ctx context.Context, command, dir string) (shell.Result, error) {
	full := command
	if dir != "" {
		full = "cd " + quote(dir) + " && " + command
	}
	return run(ctx, "ssh", append(t.args(), full), nil)
}

func (t *SSHTarget) Mkdir(ctx context.Context, dir string) error {
	res, err := t.Run(ctx, "mkdir -p "+quote(dir), "")
	if err != nil {
		return err
	}
	if !res.OK {
		return fmt.Errorf("не создали каталог %s: %s", dir, res.Tail(3))
	}
	return nil
}

// Upload отправляет файлы одним потоком через tar.
//
// Так за один заход уезжает и дерево каталогов, и права, и не нужен ни rsync
// на той стороне, ни отдельное соединение на каждый файл.
func (t *SSHTarget) Upload(ctx context.Context, root string, paths []string, dest string) error {
	tarArgs := append([]string{"-czf", "-", "-C", root}, paths...)
	tar := exec.CommandContext(ctx, "tar", tarArgs...)

	pipe, err := tar.StdoutPipe()
	if err != nil {
		return err
	}
	var tarErr strings.Builder
	tar.Stderr = &tarErr

	if err := tar.Start(); err != nil {
		return fmt.Errorf("не запустили tar: %w", err)
	}

	res, sshErr := run(ctx, "ssh", append(t.args(), "tar -xzf - -C "+quote(dest)), pipe)
	waitErr := tar.Wait()

	switch {
	case sshErr != nil:
		return fmt.Errorf("не отправили файлы: %w", sshErr)
	case !res.OK:
		return fmt.Errorf("не отправили файлы: %s", strings.TrimSpace(res.Output()+" "+tarErr.String()))
	case waitErr != nil:
		return fmt.Errorf("tar не собрал архив: %v — %s", waitErr, strings.TrimSpace(tarErr.String()))
	}
	return nil
}

// Link переключает ссылку одним mv.
//
// ln -sfn сначала удаляет ссылку, и в этот промежуток сайт отвечал бы ошибкой.
// Поэтому ссылка создаётся под временным именем и переносится поверх.
func (t *SSHTarget) Link(ctx context.Context, target, link string) error {
	tmp := link + ".new"
	cmd := fmt.Sprintf("ln -sfn %s %s && mv -Tf %s %s", quote(target), quote(tmp), quote(tmp), quote(link))
	res, err := t.Run(ctx, cmd, "")
	if err != nil {
		return err
	}
	if !res.OK {
		return fmt.Errorf("не переключили %s: %s", link, res.Tail(3))
	}
	return nil
}

func (t *SSHTarget) ReadLink(ctx context.Context, link string) (string, error) {
	res, err := t.Run(ctx, "readlink "+quote(link), "")
	if err != nil {
		return "", err
	}
	if !res.OK {
		return "", nil
	}
	return strings.TrimSpace(res.Stdout), nil
}

func (t *SSHTarget) List(ctx context.Context, dir string) ([]string, error) {
	res, err := t.Run(ctx, "ls -1 "+quote(dir)+" 2>/dev/null || true", "")
	if err != nil {
		return nil, err
	}
	var names []string
	for _, line := range strings.Split(res.Stdout, "\n") {
		if s := strings.TrimSpace(line); s != "" {
			names = append(names, s)
		}
	}
	return names, nil
}

func (t *SSHTarget) Remove(ctx context.Context, path string) error {
	_, err := t.Run(ctx, "rm -rf "+quote(path), "")
	return err
}

func (t *SSHTarget) Exists(ctx context.Context, path string) (bool, error) {
	res, err := t.Run(ctx, "test -e "+quote(path), "")
	if err != nil {
		return false, err
	}
	return res.OK, nil
}

// LocalTarget — цель на этой же машине: каталог вместо сервера.
//
// Нужна не только для проверок: так выкатывают на ту же машину, где идёт
// сборка, — и так удобно посмотреть, что получится, ничего не трогая на сервере.
type LocalTarget struct{}

func (LocalTarget) Describe() string { return "эта машина" }

// Probe всегда успешен: идти некуда.
func (LocalTarget) Probe(context.Context) error { return nil }

func (LocalTarget) Join(parts ...string) string { return filepath.Join(parts...) }

func (LocalTarget) Run(ctx context.Context, command, dir string) (shell.Result, error) {
	return shell.Run(ctx, command, dir, nil)
}

func (LocalTarget) Mkdir(_ context.Context, dir string) error {
	return os.MkdirAll(dir, 0o755)
}

func (LocalTarget) Upload(_ context.Context, root string, paths []string, dest string) error {
	for _, p := range paths {
		from := filepath.Join(root, p)
		if _, err := os.Stat(from); err != nil {
			return fmt.Errorf("нечего отправлять: в проекте нет %q", p)
		}
		to := filepath.Join(dest, p)
		// Путь может быть вложенным (src/server.js): каталог под него нужно
		// создать самим.
		if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
			return err
		}
		if err := copyPath(from, to); err != nil {
			return err
		}
	}
	return nil
}

func copyPath(from, to string) error {
	st, err := os.Stat(from)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		data, err := os.ReadFile(from)
		if err != nil {
			return err
		}
		return os.WriteFile(to, data, st.Mode().Perm())
	}

	if err := os.MkdirAll(to, st.Mode().Perm()); err != nil {
		return err
	}
	entries, err := os.ReadDir(from)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyPath(filepath.Join(from, e.Name()), filepath.Join(to, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

func (LocalTarget) Link(_ context.Context, target, link string) error {
	if fslink.Exists(link) {
		if err := fslink.Remove(link); err != nil {
			return err
		}
	}
	return fslink.Make(target, link)
}

func (LocalTarget) ReadLink(_ context.Context, link string) (string, error) {
	if !fslink.Exists(link) {
		return "", nil
	}
	target, err := fslink.Read(link)
	if err != nil {
		return "", nil
	}
	return target, nil
}

func (LocalTarget) List(_ context.Context, dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names, nil
}

func (LocalTarget) Remove(_ context.Context, path string) error {
	return os.RemoveAll(path)
}

func (LocalTarget) Exists(_ context.Context, path string) (bool, error) {
	_, err := os.Stat(path)
	return err == nil, nil
}

// TargetFor выбирает цель по секции deploy: сервер, если задан host, иначе
// эта же машина.
func TargetFor(d *Deploy) Target {
	if d.Host == "" {
		return LocalTarget{}
	}
	return &SSHTarget{Host: d.Host, Options: d.SSH}
}
