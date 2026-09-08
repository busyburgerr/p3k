package p3k_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	p3k "github.com/busyburgerr/p3k/go"
)

// checkProject кладёт конфиг и произвольные файлы во временный каталог.
func checkProject(t *testing.T, config string, files map[string]string) *p3k.Config {
	t.Helper()

	root := t.TempDir()
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	path := filepath.Join(root, "p3k.json")
	if err := os.WriteFile(path, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := p3k.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func statuses(r p3k.CheckReport) map[string]p3k.Status {
	out := map[string]p3k.Status{}
	for _, res := range r.Results {
		out[res.Name] = res.Status
	}
	return out
}

func TestChecksSkipWhatDependsOnFailure(t *testing.T) {
	// Пропущена и не прошла — разные вещи: провал означал бы, что код плохой,
	// а он просто не проверялся.
	cfg := checkProject(t, `{
	  "checks": {
	    "сборка": { "command": "exit 1" },
	    "бюджет": { "command": "echo ок", "needs": ["сборка"] },
	    "линтер": { "command": "echo ок" }
	  }
	}`, nil)

	report, err := p3k.RunChecks(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}

	got := statuses(report)
	if got["сборка"] != p3k.Failed {
		t.Errorf("сборка должна была упасть, а она %v", got["сборка"])
	}
	if got["бюджет"] != p3k.Skipped {
		t.Errorf("бюджет должен быть пропущен, а он %v", got["бюджет"])
	}
	if got["линтер"] != p3k.Passed {
		t.Errorf("независимая проверка пострадала: %v", got["линтер"])
	}
	if report.OK() {
		t.Error("прогон с упавшей проверкой не может считаться успешным")
	}
}

func TestOptionalCheckDoesNotFailTheRun(t *testing.T) {
	cfg := checkProject(t, `{
	  "checks": { "необязательная": { "command": "exit 1", "optional": true } }
	}`, nil)

	report, err := p3k.RunChecks(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK() {
		t.Error("необязательная проверка не должна валить прогон")
	}
}

func TestSizeGateReportsLargestFiles(t *testing.T) {
	big := strings.Repeat("ы", 5000)
	cfg := checkProject(t, `{
	  "checks": { "бюджет": { "size": { "path": "dist", "max": "1kb" } } }
	}`, map[string]string{
		"dist/большой.js": big,
		"dist/малый.js":   "x",
	})

	report, err := p3k.RunChecks(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	res := report.Results[0]

	if res.Status != p3k.Failed {
		t.Fatalf("бюджет превышен, а проверка %v", res.Status)
	}
	if res.Size <= res.Max {
		t.Errorf("размер %d не больше порога %d", res.Size, res.Max)
	}
	if len(res.Largest) == 0 || !strings.Contains(res.Largest[0].Path, "большой") {
		t.Errorf("самый крупный файл не назван: %+v", res.Largest)
	}
}

func TestSizeGateCountsGzipPerFile(t *testing.T) {
	// Сжатый текст заметно меньше исходного: если бы мерили несжатым,
	// бюджет не прошёл бы.
	cfg := checkProject(t, `{
	  "checks": { "бюджет": { "size": { "path": "dist", "max": "2kb", "gzip": true } } }
	}`, map[string]string{"dist/app.js": strings.Repeat("одно и то же ", 2000)})

	report, err := p3k.RunChecks(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	if report.Results[0].Status != p3k.Passed {
		t.Errorf("сжатый файл должен уложиться в бюджет: %d байт", report.Results[0].Size)
	}
}

func TestCacheSkipsUnchangedWork(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "runs.txt")
	cfg := checkProject(t, fmt.Sprintf(`{
	  "checks": { "тесты": { "command": %q, "inputs": ["src"] } }
	}`, "echo run>> "+quote(marker)), map[string]string{"src/main.go": "package main"})

	ctx := context.Background()
	first, err := p3k.RunChecks(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if first.Results[0].Status != p3k.Passed {
		t.Fatalf("первый прогон: %v", first.Results[0].Status)
	}

	second, err := p3k.RunChecks(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if second.Results[0].Status != p3k.Cached {
		t.Errorf("второй прогон должен был взяться из кэша, а он %v", second.Results[0].Status)
	}

	// Правим вход — кэш обязан обесцениться.
	if err := os.WriteFile(filepath.Join(cfg.Root, "src", "main.go"), []byte("package other"), 0o644); err != nil {
		t.Fatal(err)
	}
	third, err := p3k.RunChecks(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if third.Results[0].Status == p3k.Cached {
		t.Error("после правки входа проверка обязана запуститься заново")
	}
}

func TestWithoutInputsNothingIsCached(t *testing.T) {
	// Не зная, от чего результат зависит, мы не вправе утверждать, что ничего
	// не изменилось.
	cfg := checkProject(t, `{"checks": {"тесты": {"command": "echo ок"}}}`, nil)

	ctx := context.Background()
	if _, err := p3k.RunChecks(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	second, err := p3k.RunChecks(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if second.Results[0].Status == p3k.Cached {
		t.Error("проверка без inputs не должна кэшироваться")
	}
}

func TestCheckOnlyPullsInDependencies(t *testing.T) {
	cfg := checkProject(t, `{
	  "checks": {
	    "сборка": { "command": "echo ок" },
	    "бюджет": { "command": "echo ок", "needs": ["сборка"] },
	    "линтер": { "command": "echo ок" }
	  }
	}`, nil)

	report, err := p3k.RunChecks(context.Background(), cfg, p3k.WithCheckOnly("бюджет"))
	if err != nil {
		t.Fatal(err)
	}
	got := statuses(report)
	if _, ok := got["сборка"]; !ok {
		t.Error("бюджет без сборки неразрешим — она должна была подтянуться")
	}
	if _, ok := got["линтер"]; ok {
		t.Error("линтер ни при чём — его звать не просили")
	}
	if len(got) != 2 {
		t.Errorf("прогнали не то: %v", got)
	}
}
