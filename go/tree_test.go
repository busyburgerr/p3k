package p3k_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	p3k "github.com/busyburgerr/p3k/go"
)

// ticker — команда, которая запускает ещё одну оболочку, а та в цикле дописывает
// файл. Внук, а не ребёнок: ровно он и остаётся жить, когда снимают только
// того, кого запустили сами.
//
// Так выглядит любой `npm run dev`: оболочка запустила Node, Node запустил
// сборщик. Убив оболочку, вы не тронули никого из них.
func ticker(file string, ticks int) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`cmd /c "for /L %%i in (1,1,%d) do (echo t>> %s& ping -n 2 127.0.0.1 >NUL)"`, ticks, quote(file))
	}
	// Двоеточие в конце не украшение: без него оболочка заметит, что вложенная
	// команда единственная, и заменит себя ею — внука не получится, а получится
	// тот же самый процесс, и проверять станет нечего.
	return fmt.Sprintf(`sh -c 'for i in $(seq %d); do echo t >> %s; sleep 1; done'; :`, ticks, quote(file))
}

func size(t *testing.T, path string) int64 {
	t.Helper()
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

func TestStopKillsGrandchildren(t *testing.T) {
	file := filepath.Join(t.TempDir(), "ticks.txt")

	cfg := project(t, fmt.Sprintf(`{
	  "processes": { "app": { "command": %q } }
	}`, ticker(file, 600)))

	env := p3k.New(cfg)
	if err := env.Start(context.Background()); err != nil {
		t.Fatalf("не поднялось: %v", err)
	}

	// Даём внуку поработать: без этого нечего будет сравнивать.
	deadline := time.Now().Add(15 * time.Second)
	for size(t, file) == 0 && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
	if size(t, file) == 0 {
		env.Stop(context.Background())
		t.Fatal("внук не начал писать — проверять нечего")
	}

	if err := env.Stop(context.Background()); err != nil {
		t.Fatalf("остановка вернула ошибку: %v", err)
	}

	// После остановки файл не должен расти. Если внук выжил, он допишет ещё.
	after := size(t, file)
	time.Sleep(4 * time.Second)
	if grown := size(t, file); grown != after {
		t.Errorf("внук пережил остановку: файл вырос с %d до %d байт", after, grown)
	}
}

// Тот же случай, но родителя снимают жёстко, минуя всю нашу уборку.
//
// На Unix это ничем не отличается от предыдущего: группа процессов переживёт
// смерть лидера. На Windows объект задания снимает дерево силами ядра — именно
// ради этого он и заведён, и проверить это стоит отдельно.
func TestKillLeavesNoOrphans(t *testing.T) {
	file := filepath.Join(t.TempDir(), "ticks.txt")

	cfg := project(t, fmt.Sprintf(`{
	  "processes": { "app": { "command": %q } }
	}`, ticker(file, 600)))

	env := p3k.New(cfg, p3k.WithStopGrace(0))
	if err := env.Start(context.Background()); err != nil {
		t.Fatalf("не поднялось: %v", err)
	}

	deadline := time.Now().Add(15 * time.Second)
	for size(t, file) == 0 && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}

	// Нулевая отсрочка означает «снимать сразу»: вежливая просьба пропускается.
	if err := env.Stop(context.Background()); err != nil {
		t.Fatalf("остановка вернула ошибку: %v", err)
	}

	after := size(t, file)
	time.Sleep(4 * time.Second)
	if grown := size(t, file); grown != after {
		t.Errorf("после снятия дерево продолжает работать: файл вырос с %d до %d байт", after, grown)
	}
}
