package p3k_test

import (
	"regexp"
	"strings"
	"testing"

	p3k "github.com/busyburgerr/p3k/go"
)

func TestComposeBuildsFromResourceRegistry(t *testing.T) {
	plan := p3k.Compose(map[string]p3k.ResourceRef{
		"db": {Type: "postgres", Ports: map[string]int{"port": 5432}},
	}, "магазин")

	if plan == nil {
		t.Fatal("манифест не собрался")
	}
	if len(plan.Services) != 1 || plan.Services[0] != "db" {
		t.Errorf("службы разъехались: %v", plan.Services)
	}
	for _, want := range []string{`image: "postgres:16"`, `db-data:/var/lib/postgresql/data`, "volumes:\n  db-data: null"} {
		if !strings.Contains(plan.YAML, want) {
			t.Errorf("в манифесте нет %q:\n%s", want, plan.YAML)
		}
	}
}

// Открытый наружу порт базы — самая дорогая из опечаток в этом файле,
// поэтому она проверяется отдельно и сразу для всего каталога.
func TestProdPortsStayOnLoopback(t *testing.T) {
	for _, def := range p3k.Resources() {
		if def.Prod == nil {
			continue
		}
		form := def.Prod(p3k.ResourceOpts{
			Name:      def.ID,
			Container: "x-" + def.ID,
			Project:   "x",
			Ports:     def.DefaultPorts(),
		})

		ports, _ := form.Service["ports"].([]any)
		for _, p := range ports {
			mapping, _ := p.(string)
			// Край — единственное исключение: он и должен смотреть в интернет.
			if def.ID == "nginx" {
				if mapping != "80:80" {
					t.Errorf("nginx: неожиданный проброс %q", mapping)
				}
				continue
			}
			if !strings.HasPrefix(mapping, "127.0.0.1:") {
				t.Errorf("%s: порт торчит наружу — %q", def.ID, mapping)
			}
		}
	}
}

func TestProdServicesRestartAndReportHealth(t *testing.T) {
	for _, def := range p3k.Resources() {
		if def.Prod == nil {
			continue
		}
		form := def.Prod(p3k.ResourceOpts{Name: def.ID, Container: "x", Project: "x", Ports: def.DefaultPorts()})

		if form.Service["restart"] != "unless-stopped" {
			t.Errorf("%s: служба не перезапускается сама", def.ID)
		}
		if form.Service["healthcheck"] == nil {
			// Без healthcheck флагу --wait нечего ждать, и compose вернётся
			// раньше, чем служба начнёт отвечать.
			t.Errorf("%s: нет проверки здоровья", def.ID)
		}
	}
}

func TestComposeKeepsSecretsOutOfTheManifest(t *testing.T) {
	plan := p3k.Compose(map[string]p3k.ResourceRef{
		"db": {Type: "postgres"},
		"s3": {Type: "minio"},
	}, "магазин")
	if plan == nil {
		t.Fatal("манифест не собрался")
	}

	if !regexp.MustCompile(`\$\{POSTGRES_PASSWORD:\?`).MatchString(plan.YAML) {
		t.Error("пароль базы должен быть ссылкой на переменную, а не значением")
	}
	if strings.Contains(plan.YAML, "minioadmin") {
		t.Error("локальные ключи утекли в продакшен-манифест")
	}

	unfilled := strings.Join(plan.Unfilled(), " ")
	for _, key := range []string{"POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD"} {
		if !strings.Contains(unfilled, key) {
			t.Errorf("%s не назван среди того, что нужно заполнить: %v", key, plan.Unfilled())
		}
	}
	if !strings.Contains(plan.EnvExample(), "POSTGRES_PASSWORD=<") {
		t.Error("в заготовке нет места под пароль")
	}
}

func TestDevOnlyResourcesDoNotGoToProduction(t *testing.T) {
	plan := p3k.Compose(map[string]p3k.ResourceRef{
		"mail": {Type: "mailpit"},
		"db":   {Type: "postgres"},
	}, "магазин")
	if plan == nil {
		t.Fatal("манифест не собрался")
	}
	if len(plan.Services) != 1 || plan.Services[0] != "db" {
		t.Errorf("в прод поехало лишнее: %v", plan.Services)
	}
	if len(plan.Skipped) != 1 || !strings.Contains(plan.Skipped[0], "mail") {
		t.Errorf("пропущенное не названо: %v", plan.Skipped)
	}
}

func TestComposeEmptyWhenNothingToRun(t *testing.T) {
	cases := map[string]map[string]p3k.ResourceRef{
		"ничего нет":            {},
		"только для разработки": {"mail": {Type: "mailpit"}},
		"неизвестный тип":       {"x": {Type: "чего-то-нет"}},
	}
	for name, resources := range cases {
		if p3k.Compose(resources, "магазин") != nil {
			t.Errorf("%s: манифест должен быть пустым", name)
		}
	}
}

// Каталог — это данные, и ошибка в нём проявилась бы только у того, кто
// добавил ресурс себе. Поэтому каждый ресурс проверяется тем же разбором
// конфига, каким читается настоящий проект.
func TestEveryResourceProducesUsableProcess(t *testing.T) {
	for _, def := range p3k.Resources() {
		opts := p3k.ResourceOpts{
			Name:      def.ID,
			Container: "магазин-" + def.ID,
			Project:   "магазин",
			Ports:     def.DefaultPorts(),
		}
		proc := def.Process(opts)

		if proc.Command == "" {
			t.Errorf("%s: пустая команда", def.ID)
		}
		if proc.Ready == nil {
			t.Errorf("%s: нет условия готовности", def.ID)
		}
		if proc.Stop == "" {
			t.Errorf("%s: нет команды остановки — контейнер переживёт остановку окружения", def.ID)
		}
		if len(def.Env(opts)) == 0 {
			t.Errorf("%s: ресурс ничего не даёт приложению", def.ID)
		}
	}
}

func TestResourceDefaultPortsDoNotClash(t *testing.T) {
	seen := map[int]string{}
	for _, def := range p3k.Resources() {
		for _, p := range def.Ports {
			if !p.Bind {
				continue
			}
			if owner, busy := seen[p.Port]; busy {
				t.Errorf("порт %d по умолчанию и у %q, и у %q", p.Port, owner, def.ID)
			}
			seen[p.Port] = def.ID
		}
	}
}
