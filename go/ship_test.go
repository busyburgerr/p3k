package p3k_test

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	p3k "github.com/busyburgerr/p3k/go"
)

// Полный цикл выкатки на локальной цели.
//
// Проверяется главное обещание: испорченный выпуск не остаётся работать.
// Приложение здесь — файл version.txt, который читает поднятый в тесте сервер;
// он отвечает 500, если содержимое не то. Так проверка здоровья настоящая, а
// не имитация.
func TestShipRollsBackUnhealthyRelease(t *testing.T) {
	project := t.TempDir()
	server := t.TempDir()
	if err := os.Mkdir(filepath.Join(project, "app"), 0o755); err != nil {
		t.Fatal(err)
	}

	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		body, err := os.ReadFile(filepath.Join(server, "current", "app", "version.txt"))
		if err != nil {
			http.Error(w, "нет файла", http.StatusInternalServerError)
			return
		}
		if strings.TrimSpace(string(body)) != "годная" {
			http.Error(w, string(body), http.StatusInternalServerError)
			return
		}
		w.Write(body)
	})}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(ln)
	defer srv.Close()

	config := fmt.Sprintf(`{
	  "deploy": {
	    "path": %q,
	    "upload": ["app"],
	    "checks": false,
	    "health": { "url": "http://%s/", "timeout": 4 }
	  }
	}`, server, ln.Addr())
	if err := os.WriteFile(filepath.Join(project, "p3k.json"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := p3k.Load(filepath.Join(project, "p3k.json"))
	if err != nil {
		t.Fatal(err)
	}
	version := filepath.Join(project, "app", "version.txt")
	ctx := context.Background()

	// Первая выкатка: здоровая.
	if err := os.WriteFile(version, []byte("годная"), 0o644); err != nil {
		t.Fatal(err)
	}
	first, err := p3k.Ship(ctx, cfg)
	if err != nil {
		t.Fatalf("здоровый выпуск должен выкатиться: %v", err)
	}
	if !first.Healthy || first.Previous != "" {
		t.Errorf("первая выкатка описана неверно: %+v", first)
	}
	live := filepath.Join(server, "current", "app", "version.txt")
	if data, _ := os.ReadFile(live); string(data) != "годная" {
		t.Fatalf("через current читается %q", data)
	}

	// Вторая: сломанная. Секунда паузы нужна, чтобы имя выпуска отличалось
	// временем, а не порядковым номером, — так нагляднее.
	time.Sleep(time.Second)
	if err := os.WriteFile(version, []byte("сломанная"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := p3k.Ship(ctx, cfg)
	if err == nil {
		t.Fatal("нездоровый выпуск должен провалиться")
	}
	if second == nil || !second.RolledBack {
		t.Fatalf("отката не было: %+v (%v)", second, err)
	}

	// Главное: цель вернулась к прежнему выпуску, а не осталась сломанной.
	if data, _ := os.ReadFile(live); string(data) != "годная" {
		t.Errorf("после отката через current читается %q, ожидали прежний выпуск", data)
	}
	res, err := http.Get("http://" + ln.Addr().String() + "/")
	if err != nil || res.StatusCode != http.StatusOK {
		t.Errorf("сервер не отвечает после отката: %v", err)
	}

	// Оба выпуска остаются на цели: сломанный нужен, чтобы посмотреть логи.
	list, current, err := p3k.Releases(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Errorf("выпусков на цели %d, ожидали 2: %v", len(list), list)
	}
	if current != first.Release {
		t.Errorf("работает %q, ожидали %q", current, first.Release)
	}
}

func TestRollbackWalksBackOneRelease(t *testing.T) {
	project := t.TempDir()
	server := t.TempDir()
	if err := os.Mkdir(filepath.Join(project, "app"), 0o755); err != nil {
		t.Fatal(err)
	}

	config := fmt.Sprintf(`{"deploy": {"path": %q, "upload": ["app"], "checks": false}}`, server)
	if err := os.WriteFile(filepath.Join(project, "p3k.json"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := p3k.Load(filepath.Join(project, "p3k.json"))
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	version := filepath.Join(project, "app", "version.txt")

	os.WriteFile(version, []byte("первый"), 0o644)
	first, err := p3k.Ship(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(time.Second)
	os.WriteFile(version, []byte("второй"), 0o644)
	second, err := p3k.Ship(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if second.Previous != first.Release {
		t.Errorf("вторая выкатка не помнит прежний выпуск: %+v", second)
	}

	live := filepath.Join(server, "current", "app", "version.txt")
	if data, _ := os.ReadFile(live); string(data) != "второй" {
		t.Fatalf("работает %q, ожидали второй выпуск", data)
	}

	// Откат без всякой поломки: просто вернуться на шаг назад.
	back, err := p3k.Rollback(ctx, cfg)
	if err != nil {
		t.Fatalf("откат не удался: %v", err)
	}
	if back.Release != first.Release {
		t.Errorf("откатились на %q, ожидали %q", back.Release, first.Release)
	}
	if data, _ := os.ReadFile(live); string(data) != "первый" {
		t.Errorf("после отката работает %q", data)
	}

	// Дальше откатываться некуда — и об этом надо сказать, а не молча ничего
	// не сделать.
	if _, err := p3k.Rollback(ctx, cfg); err == nil {
		t.Error("откат с самого раннего выпуска должен отказать")
	}
}

func TestShipDryRunChangesNothing(t *testing.T) {
	project := t.TempDir()
	server := t.TempDir()
	os.Mkdir(filepath.Join(project, "app"), 0o755)
	os.WriteFile(filepath.Join(project, "app", "version.txt"), []byte("годная"), 0o644)

	config := fmt.Sprintf(`{"deploy": {"path": %q, "upload": ["app"], "checks": false}}`, server)
	os.WriteFile(filepath.Join(project, "p3k.json"), []byte(config), 0o644)
	cfg, err := p3k.Load(filepath.Join(project, "p3k.json"))
	if err != nil {
		t.Fatal(err)
	}

	var log strings.Builder
	if _, err := p3k.Ship(context.Background(), cfg, p3k.DryRun(), p3k.WithShipOutput(&log)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(log.String(), "Ничего не изменено") {
		t.Errorf("в отчёте нет главного: %s", log.String())
	}

	entries, _ := os.ReadDir(server)
	if len(entries) != 0 {
		t.Errorf("холостой прогон наследил на цели: %v", entries)
	}
}

func TestShipRefusesWithoutDeploySection(t *testing.T) {
	project := t.TempDir()
	os.WriteFile(filepath.Join(project, "p3k.json"), []byte(`{"processes":{"app":{"command":"echo"}}}`), 0o644)
	cfg, err := p3k.Load(filepath.Join(project, "p3k.json"))
	if err != nil {
		t.Fatal(err)
	}

	_, err = p3k.Ship(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "нет секции deploy") {
		t.Errorf("ожидалось внятное объяснение, получили: %v", err)
	}
}

func TestUniqueReleaseKeepsOrder(t *testing.T) {
	base := p3k.ReleaseID(time.Date(2026, 9, 7, 17, 22, 56, 0, time.UTC))
	if base != "20260907-172256" {
		t.Fatalf("имя выпуска %q", base)
	}

	first, _ := p3k.UniqueRelease(nil, base)
	second, _ := p3k.UniqueRelease([]string{first}, base)
	third, _ := p3k.UniqueRelease([]string{first, second}, base)

	if !(first < second && second < third) {
		t.Errorf("имена перестали сортироваться по времени: %q %q %q", first, second, third)
	}
	if _, err := p3k.UniqueRelease([]string{}, base); err != nil {
		t.Errorf("свободное имя не должно давать ошибку: %v", err)
	}
}
