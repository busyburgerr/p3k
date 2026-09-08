package p3k_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	p3k "github.com/busyburgerr/p3k/go"
)

func parse(t *testing.T, config string) (*p3k.Config, error) {
	t.Helper()
	return p3k.Parse([]byte(config), "p3k.json")
}

func TestParseReadsEveryKindOfReadiness(t *testing.T) {
	cfg, err := parse(t, `{
	  "processes": {
	    "порт":   { "command": "a", "ready": { "port": 5432 } },
	    "адрес":  { "command": "b", "ready": { "http": "http://localhost:4000/health", "status": 204 } },
	    "успех":  { "command": "c", "ready": { "exec": "docker exec db pg_isready" } },
	    "строка": { "command": "d", "ready": { "log": "ready in" } },
	    "пауза":  { "command": "e", "ready": { "delay": 250 } }
	  }
	}`)
	if err != nil {
		t.Fatal(err)
	}

	want := map[string]p3k.Ready{
		"порт":   p3k.Port(5432),
		"адрес":  p3k.HTTP{URL: "http://localhost:4000/health", Status: 204},
		"успех":  p3k.Exec("docker exec db pg_isready"),
		"строка": p3k.Log("ready in"),
		"пауза":  p3k.Delay(250 * time.Millisecond),
	}
	for name, expected := range want {
		p, ok := cfg.Process(name)
		if !ok {
			t.Fatalf("нет процесса %q", name)
		}
		if p.Ready != expected {
			t.Errorf("%s: разобрали %#v, ожидали %#v", name, p.Ready, expected)
		}
	}
}

func TestParseRejectsBrokenConfigsWithPlace(t *testing.T) {
	cases := map[string]string{
		"процесс без команды":         `{"processes": {"app": {}}}`,
		"ссылка в никуда":             `{"processes": {"app": {"command": "a", "needs": ["нет"]}}}`,
		"зависимость от себя":         `{"processes": {"app": {"command": "a", "needs": ["app"]}}}`,
		"непонятная готовность":       `{"processes": {"app": {"command": "a", "ready": {"когда": "потом"}}}}`,
		"адрес без схемы":             `{"processes": {"app": {"command": "a", "ready": {"http": "localhost:4000"}}}}`,
		"проверка без command и size": `{"checks": {"c": {}}}`,
		"негодный бюджет":             `{"checks": {"c": {"size": {"path": "dist", "max": "много"}}}}`,
		"выкатка без пути":            `{"deploy": {"upload": ["dist"]}}`,
		"выкатка без отправки":        `{"deploy": {"path": "/srv/app"}}`,
		"отправка наружу проекта":     `{"deploy": {"path": "/srv/app", "upload": ["../секреты"]}}`,
		"хранить меньше двух":         `{"deploy": {"path": "/srv/app", "upload": ["dist"], "keep": 1}}`,
	}

	for name, config := range cases {
		_, err := parse(t, config)
		if err == nil {
			t.Errorf("%s: ошибки не было, а должна", name)
			continue
		}
		var cfgErr *p3k.Error
		if !errors.As(err, &cfgErr) {
			t.Errorf("%s: ошибка не называет место: %v", name, err)
			continue
		}
		if !strings.Contains(cfgErr.Where, "p3k.json") {
			t.Errorf("%s: в месте нет имени файла: %q", name, cfgErr.Where)
		}
	}
}

func TestParseKeepsDeployDefaults(t *testing.T) {
	cfg, err := parse(t, `{"deploy": {"path": "/srv/app", "upload": ["dist"]}}`)
	if err != nil {
		t.Fatal(err)
	}
	d := cfg.Deploy
	if d.Keep != 5 || !d.Checks || !d.Resources {
		t.Errorf("умолчания разъехались: %+v", d)
	}
	if d.Host != "" {
		t.Errorf("без host целью должна быть эта машина, получили %q", d.Host)
	}
	if d.Health != nil {
		t.Errorf("проверки здоровья не просили, а она есть: %+v", d.Health)
	}
}

func TestParseHealthBothForms(t *testing.T) {
	short, err := parse(t, `{"deploy": {"path": "/a", "upload": ["d"], "health": "https://x/health"}}`)
	if err != nil {
		t.Fatal(err)
	}
	if short.Deploy.Health.URL != "https://x/health" || short.Deploy.Health.Timeout != time.Minute {
		t.Errorf("строкой разобралось не так: %+v", short.Deploy.Health)
	}

	long, err := parse(t, `{"deploy": {"path": "/a", "upload": ["d"],
	  "health": {"url": "http://x", "status": 204, "timeout": 5}}}`)
	if err != nil {
		t.Fatal(err)
	}
	if long.Deploy.Health.Status != 204 || long.Deploy.Health.Timeout != 5*time.Second {
		t.Errorf("объектом разобралось не так: %+v", long.Deploy.Health)
	}
}

func TestFindWalksUp(t *testing.T) {
	root := t.TempDir()
	deep := filepath.Join(root, "внутри", "ещё", "глубже")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "p3k.json")
	if err := os.WriteFile(want, []byte(`{"processes":{"a":{"command":"echo"}}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := p3k.Find(deep)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("нашли %q, ожидали %q", got, want)
	}

	if _, err := p3k.Find(t.TempDir()); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("на пустом каталоге ожидался os.ErrNotExist, получили %v", err)
	}
}

func TestEnvValuesAcceptNumbers(t *testing.T) {
	// "PORT": 4000 пишут по привычке, и придираться тут не за что.
	cfg, err := parse(t, `{"processes": {"app": {"command": "a", "env": {"PORT": 4000}}}}`)
	if err != nil {
		t.Fatal(err)
	}
	p, _ := cfg.Process("app")
	if p.Env["PORT"] != "4000" {
		t.Errorf("число в окружении разобралось как %q", p.Env["PORT"])
	}
}

// Кавычки внутри команды — не редкость: они есть в первом же рецепте с MinIO.
// На Windows их легко потерять, если довериться тому, как Go экранирует
// аргументы, поэтому проверяем на настоящем запуске.
func TestCommandWithQuotesSurvivesTheShell(t *testing.T) {
	cfg := project(t, `{
	  "processes": {
	    "app": { "command": "echo --console-address \":9001\"", "oneShot": true }
	  }
	}`)

	env := p3k.New(cfg)
	if err := env.Start(context.Background()); err != nil {
		t.Fatalf("команда с кавычками не отработала: %v", err)
	}
	defer env.Stop(context.Background())

	if out := env.Output("app"); !strings.Contains(out, ":9001") {
		t.Errorf("кавычки исказили команду, вывод: %q", out)
	}
}
