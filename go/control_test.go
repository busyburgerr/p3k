package p3k_test

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/busyburgerr/p3k/go/internal/shell"
)

// Контрольный опыт: запускаем ту же команду, но снимаем только того, кого
// запустили сами, без объекта задания. Если внук при этом тоже умирает, значит
// проверка на дерево ничего не доказывает.
func TestControlPlainKillLeavesOrphan(t *testing.T) {
	file := filepath.Join(t.TempDir(), "ticks.txt")

	// Внук переживёт этот тест — в том и смысл опыта. Поэтому цикл короткий:
	// брошенный процесс истечёт сам примерно за десять секунд.
	cmd := shell.Detached(ticker(file, 10), "", nil)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for size(t, file) == 0 && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
	if size(t, file) == 0 {
		t.Fatal("команда не начала писать — опыт негоден")
	}

	cmd.Process.Kill()
	cmd.Wait()

	after := size(t, file)
	time.Sleep(4 * time.Second)
	grown := size(t, file)
	t.Logf("после обычного Kill: было %d, стало %d", after, grown)
	if grown == after {
		t.Log("внук умер и без объекта задания — проверка на дерево ничего не доказывает")
	} else {
		t.Log("внук выжил — значит объект задания и правда делает работу")
	}
}
