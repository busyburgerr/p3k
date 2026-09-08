package p3k_test

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	p3k "github.com/busyburgerr/p3k/go"
)

// project кладёт конфиг во временный каталог и возвращает его разобранным.
func project(t *testing.T, config string) *p3k.Config {
	t.Helper()

	root := t.TempDir()
	path := filepath.Join(root, "p3k.json")
	if err := os.WriteFile(path, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := p3k.Load(path)
	if err != nil {
		t.Fatalf("конфиг не разобрался: %v", err)
	}
	return cfg
}

// Строки, которые процессы печатают, и пути, в которые они пишут, держим в
// латинице без кавычек: cmd.exe отдаёт вывод в кодировке 866, и кириллица от
// echo вернулась бы мусором, а обратные слэши в кавычках он читает как есть.
func quote(path string) string { return `"` + path + `"` }

// hold — команда, которая просто держится, пока её не снимут. Нужна там, где
// важен сам факт живого процесса, а не то, что он делает.
func hold() string {
	if runtime.GOOS == "windows" {
		return "ping -n 600 127.0.0.1 > NUL"
	}
	return "sleep 600"
}

func TestStartWaitsForReadinessNotJustLaunch(t *testing.T) {
	// Процесс печатает нужную строку не сразу: если бы Start возвращался
	// по факту запуска, проверка ниже поймала бы пустой вывод.
	var command string
	if runtime.GOOS == "windows" {
		command = "ping -n 3 127.0.0.1 > NUL && echo READY && " + hold()
	} else {
		command = "sleep 2 && echo READY && " + hold()
	}

	cfg := project(t, fmt.Sprintf(`{
	  "processes": {
	    "app": { "command": %q, "ready": { "log": "READY" } }
	  }
	}`, command))

	env := p3k.New(cfg)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	start := time.Now()
	if err := env.Start(ctx); err != nil {
		t.Fatalf("не поднялось: %v", err)
	}
	defer env.Stop(context.Background())

	if elapsed := time.Since(start); elapsed < time.Second {
		t.Errorf("Start вернулся за %s — он не дождался готовности", elapsed)
	}
	if out := env.Output("app"); !strings.Contains(out, "READY") {
		t.Errorf("в выводе нет искомой строки, есть: %q", out)
	}
}

// mark оборачивает условие готовности, запоминая, когда оно выполнилось.
// Так порядок волн проверяется через тот же интерфейс, которым пользуются
// сами условия, — и не зависит от того, что умеет местная оболочка.
type mark struct {
	inner p3k.Ready
	name  string
	mu    *sync.Mutex
	order *[]string
}

func (m mark) String() string { return m.inner.String() }

func (m mark) Wait(ctx context.Context, p p3k.Probe) error {
	if err := m.inner.Wait(ctx, p); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	*m.order = append(*m.order, m.name)
	return nil
}

func TestWavesRespectDependencies(t *testing.T) {
	dir := t.TempDir()
	// Каждый шаг оставляет свой файл: так видно, что процессы правда работали,
	// а не только были помечены готовыми.
	step := func(name string) string {
		return fmt.Sprintf("echo %s> %s", name, quote(filepath.Join(dir, name+".txt")))
	}

	cfg := project(t, fmt.Sprintf(`{
	  "processes": {
	    "db":      { "command": %q, "oneShot": true },
	    "cache":   { "command": %q, "oneShot": true },
	    "migrate": { "command": %q, "oneShot": true, "needs": ["db"] },
	    "api":     { "command": %q, "oneShot": true, "needs": ["migrate", "cache"] }
	  }
	}`, step("db"), step("cache"), step("migrate"), step("api")))

	var mu sync.Mutex
	var order []string
	env := p3k.New(cfg,
		p3k.WithReady("db", mark{p3k.Succeeded{}, "db", &mu, &order}),
		p3k.WithReady("cache", mark{p3k.Succeeded{}, "cache", &mu, &order}),
		p3k.WithReady("migrate", mark{p3k.Succeeded{}, "migrate", &mu, &order}),
		p3k.WithReady("api", mark{p3k.Succeeded{}, "api", &mu, &order}),
	)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := env.Start(ctx); err != nil {
		t.Fatalf("не поднялось: %v", err)
	}
	defer env.Stop(context.Background())

	for _, name := range []string{"db", "cache", "migrate", "api"} {
		if _, err := os.Stat(filepath.Join(dir, name+".txt")); err != nil {
			t.Errorf("шаг %q не отработал", name)
		}
	}

	if len(order) != 4 {
		t.Fatalf("готовыми стали не все: %v", order)
	}
	pos := map[string]int{}
	for i, name := range order {
		pos[name] = i
	}
	if pos["db"] > pos["migrate"] {
		t.Errorf("миграции пошли раньше базы: %v", order)
	}
	if pos["migrate"] > pos["api"] || pos["cache"] > pos["api"] {
		t.Errorf("приложение стартовало раньше своих зависимостей: %v", order)
	}
}

func TestStartCleansUpAfterFailure(t *testing.T) {
	// Второй процесс не станет готовым никогда. Первый к этому моменту уже
	// работает — и не должен остаться работать после неудачи.
	cfg := project(t, fmt.Sprintf(`{
	  "processes": {
	    "first":  { "command": %q },
	    "second": { "command": %q, "needs": ["first"], "ready": { "log": "этого не будет никогда" } }
	  }
	}`, hold(), hold()))

	env := p3k.New(cfg, p3k.WithReadyTimeout(2*time.Second))
	err := env.Start(context.Background())
	if err == nil {
		env.Stop(context.Background())
		t.Fatal("ожидалась ошибка: процесс не мог стать готовым")
	}
	if !strings.Contains(err.Error(), "не стал готовым") {
		t.Errorf("ошибка не объясняет причину: %v", err)
	}

	if running := env.Running(); len(running) > 0 {
		t.Errorf("после неудачного подъёма остались работать: %v", running)
	}
}

func TestStopRunsStopCommandForExitedOneShot(t *testing.T) {
	// `docker compose up -d` выходит сразу, а контейнеры продолжают жить.
	// Если команду остановки выполнять только для живых процессов, за таким
	// шагом никто не приберёт — и порты останутся заняты до следующего раза.
	marker := filepath.Join(t.TempDir(), "stopped.txt")

	cfg := project(t, fmt.Sprintf(`{
	  "processes": {
	    "services": {
	      "command": "echo up",
	      "oneShot": true,
	      "stop": %q
	    }
	  }
	}`, fmt.Sprintf("echo down>> %s", quote(marker))))

	env := p3k.New(cfg)
	if err := env.Start(context.Background()); err != nil {
		t.Fatalf("не поднялось: %v", err)
	}
	if err := env.Stop(context.Background()); err != nil {
		t.Fatalf("остановка вернула ошибку: %v", err)
	}

	if _, err := os.Stat(marker); err != nil {
		t.Error("команда остановки не выполнилась для уже завершившегося шага — за контейнерами никто не прибрал")
	}
}

func TestReadyPortWaitsForRealListener(t *testing.T) {
	// Занимаем порт заранее и проверяем, что условие его видит. Так тест не
	// зависит от того, умеет ли машина поднимать сервер сторонними средствами.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	cfg := project(t, fmt.Sprintf(`{
	  "processes": {
	    "app": { "command": %q, "ready": { "port": %d } }
	  }
	}`, hold(), port))

	env := p3k.New(cfg, p3k.WithReadyTimeout(5*time.Second))
	if err := env.Start(context.Background()); err != nil {
		t.Fatalf("порт слушают, а условие не сработало: %v", err)
	}
	env.Stop(context.Background())
}

func TestReadyHTTPAcceptsWorkingServer(t *testing.T) {
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(ln)
	defer srv.Close()

	url := fmt.Sprintf("http://%s/", ln.Addr())
	cfg := project(t, fmt.Sprintf(`{
	  "processes": {
	    "app": { "command": %q, "ready": { "http": %q } }
	  }
	}`, hold(), url))

	env := p3k.New(cfg, p3k.WithReadyTimeout(5*time.Second))
	if err := env.Start(context.Background()); err != nil {
		// 404 — это работающий сервер: он ответил. Неготовым его делает
		// только отсутствие ответа или пятисотый.
		t.Fatalf("404 от живого сервера должен считаться готовностью: %v", err)
	}
	env.Stop(context.Background())
}

func TestWaitReturnsWhenLongLivedProcessDies(t *testing.T) {
	var command string
	if runtime.GOOS == "windows" {
		command = "ping -n 2 127.0.0.1 > NUL"
	} else {
		command = "sleep 1"
	}

	cfg := project(t, fmt.Sprintf(`{"processes": {"app": {"command": %q}}}`, command))

	env := p3k.New(cfg)
	if err := env.Start(context.Background()); err != nil {
		t.Fatalf("не поднялось: %v", err)
	}
	defer env.Stop(context.Background())

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	err := env.Wait(ctx)
	if err == nil {
		t.Fatal("Wait должен сообщить о смерти долгоживущего процесса")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("Wait не заметил, что процесс завершился")
	}
	if !strings.Contains(err.Error(), "app") {
		t.Errorf("непонятно, кто именно умер: %v", err)
	}
}

func TestOnlyPullsInDependencies(t *testing.T) {
	cfg := project(t, `{
	  "processes": {
	    "db":  { "command": "echo db",  "oneShot": true },
	    "api": { "command": "echo api", "oneShot": true, "needs": ["db"] },
	    "web": { "command": "echo web", "oneShot": true }
	  }
	}`)

	env := p3k.New(cfg, p3k.WithOnly("api"))
	got := env.Processes()

	want := map[string]bool{"db": true, "api": true}
	if len(got) != 2 {
		t.Fatalf("ожидались api и его зависимость db, получили %v", got)
	}
	for _, name := range got {
		if !want[name] {
			t.Errorf("лишний процесс %q в выборке %v", name, got)
		}
	}
}
