package fslink_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/busyburgerr/p3k/go/internal/fslink"
)

func TestLinkSwitchesWithoutTouchingTarget(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "первый")
	second := filepath.Join(root, "второй")
	for _, dir := range []string{first, second} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "кто.txt"), []byte(filepath.Base(dir)), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	link := filepath.Join(root, "current")
	if err := fslink.Make(first, link); err != nil {
		t.Fatalf("ссылка не создалась: %v", err)
	}
	if !fslink.Exists(link) {
		t.Fatal("ссылка создана, но не видна")
	}

	// Через ссылку виден тот выпуск, на который она указывает.
	data, err := os.ReadFile(filepath.Join(link, "кто.txt"))
	if err != nil || string(data) != "первый" {
		t.Fatalf("через ссылку читается %q (%v)", data, err)
	}

	got, err := fslink.Read(link)
	if err != nil || got != first {
		t.Errorf("ссылка указывает на %q (%v), ожидали %q", got, err, first)
	}

	// Переключение: снять и создать заново.
	if err := fslink.Remove(link); err != nil {
		t.Fatalf("ссылка не снялась: %v", err)
	}
	if err := fslink.Make(second, link); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(link, "кто.txt"))
	if err != nil || string(data) != "второй" {
		t.Fatalf("после переключения читается %q (%v)", data, err)
	}

	// Главное: снятие ссылки не тронуло прежний выпуск — на него и откатываются.
	if _, err := os.Stat(filepath.Join(first, "кто.txt")); err != nil {
		t.Errorf("прежний выпуск пострадал при переключении: %v", err)
	}
}
