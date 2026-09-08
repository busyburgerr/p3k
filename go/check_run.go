package p3k

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/busyburgerr/p3k/go/internal/shell"
)

// Status — чем закончилась проверка.
type Status int

const (
	// Passed — прошла.
	Passed Status = iota
	// Cached — прошла в прошлый раз, а входные файлы с тех пор не менялись.
	Cached
	// Failed — не прошла.
	Failed
	// Skipped — не запускалась, потому что не прошло то, от чего она зависит.
	// Это не то же самое, что «не прошла»: провал означал бы, что код плохой,
	// а он просто не проверялся.
	Skipped
)

func (s Status) String() string {
	switch s {
	case Passed:
		return "прошла"
	case Cached:
		return "без изменений"
	case Failed:
		return "не прошла"
	default:
		return "пропущена"
	}
}

// CheckResult — что стало с одной проверкой.
type CheckResult struct {
	Name     string
	Status   Status
	Duration time.Duration
	// Output — вывод команды. Заполняется только у непрошедших: у остальных
	// он никому не нужен и только мешает.
	Output string
	Err    error
	// Size и Max заполняются у бюджета размера.
	Size, Max int64
	// Largest — самые крупные файлы, если бюджет превышен.
	Largest []FileSize
}

// FileSize — файл и сколько он весит.
type FileSize struct {
	Path string
	Size int64
}

// CheckReport — итог прогона.
type CheckReport struct {
	Results  []CheckResult
	Duration time.Duration
}

// OK — все обязательные проверки прошли.
func (r CheckReport) OK() bool {
	for _, res := range r.Results {
		if res.Status == Failed {
			return false
		}
	}
	return true
}

// Failed — то, что не прошло.
func (r CheckReport) Failed() []CheckResult {
	var out []CheckResult
	for _, res := range r.Results {
		if res.Status == Failed {
			out = append(out, res)
		}
	}
	return out
}

type checkOptions struct {
	only  []string
	cache bool
	out   io.Writer
}

// CheckOption настраивает прогон проверок.
type CheckOption func(*checkOptions)

// WithCheckOnly прогоняет только названные проверки — и то, от чего они зависят.
func WithCheckOnly(names ...string) CheckOption {
	return func(o *checkOptions) { o.only = names }
}

// WithoutCache прогоняет всё заново, не заглядывая в кэш.
func WithoutCache() CheckOption { return func(o *checkOptions) { o.cache = false } }

// WithCheckOutput пишет ход прогона в w.
func WithCheckOutput(w io.Writer) CheckOption { return func(o *checkOptions) { o.out = w } }

// RunChecks прогоняет проверки проекта.
//
// Независимые идут разом, зависимые ждут своих. Успешный результат кэшируется
// по содержимому входных файлов: правите только тесты — линтер второй раз не
// запускается вовсе.
//
// Ошибка возвращается, только если прогон не удалось начать: непрошедшие
// проверки — это результат, а не ошибка Go, и они лежат в отчёте.
func RunChecks(ctx context.Context, cfg *Config, opts ...CheckOption) (CheckReport, error) {
	o := checkOptions{cache: true}
	for _, apply := range opts {
		apply(&o)
	}

	checks := cfg.Checks
	if len(o.only) > 0 {
		checks = WithNeeds(checks, o.only)
	}
	if len(checks) == 0 {
		return CheckReport{}, errors.New("в конфиге не описано ни одной проверки")
	}
	if bad := UnknownNeeds(checks); len(bad) > 0 {
		return CheckReport{}, fmt.Errorf("ссылки на неизвестные проверки: %v", bad)
	}

	waves, err := Waves(checks)
	if err != nil {
		return CheckReport{}, err
	}

	cache := loadCache(cfg.Root, o.cache)
	report := CheckReport{}
	started := time.Now()
	failed := map[string]bool{}

	for _, wave := range waves {
		var wg sync.WaitGroup
		results := make([]CheckResult, len(wave))

		for i, gate := range wave {
			i, gate := i, gate
			wg.Add(1)
			go func() {
				defer wg.Done()
				if blockedBy(gate, failed) != "" {
					results[i] = CheckResult{Name: gate.Name, Status: Skipped}
					return
				}
				results[i] = runCheck(ctx, cfg, gate, cache)
			}()
		}
		wg.Wait()

		for _, res := range results {
			if res.Status == Failed {
				failed[res.Name] = true
			}
			if o.out != nil {
				fmt.Fprintf(o.out, "  %-12s %s\n", res.Name, describe(res))
			}
		}
		report.Results = append(report.Results, results...)
	}

	report.Duration = time.Since(started)
	cache.save()
	return report, nil
}

func describe(r CheckResult) string {
	switch r.Status {
	case Cached:
		return "без изменений"
	case Skipped:
		return "пропущена — не прошло то, от чего она зависит"
	case Failed:
		if r.Max > 0 {
			return fmt.Sprintf("не прошла — %s из %s", FormatSize(r.Size), FormatSize(r.Max))
		}
		return fmt.Sprintf("не прошла за %s", r.Duration.Round(time.Millisecond))
	default:
		if r.Max > 0 {
			return fmt.Sprintf("%s из %s", FormatSize(r.Size), FormatSize(r.Max))
		}
		return r.Duration.Round(time.Millisecond).String()
	}
}

// blockedBy возвращает имя проверки, из-за которой эту запускать бессмысленно.
func blockedBy(gate Check, failed map[string]bool) string {
	for _, need := range gate.Needs {
		if failed[need] {
			return need
		}
	}
	return ""
}

func runCheck(ctx context.Context, cfg *Config, gate Check, cache *checkCache) CheckResult {
	started := time.Now()
	res := CheckResult{Name: gate.Name}

	key, cacheable := cache.key(cfg.Root, gate)
	if cacheable && cache.hit(gate.Name, key) {
		res.Status = Cached
		return res
	}

	if gate.Size != nil {
		res = measure(cfg.Root, gate)
	} else {
		dir := cfg.Root
		if gate.Dir != "" {
			dir = filepath.Join(cfg.Root, gate.Dir)
		}
		out, err := shell.Run(ctx, gate.Command, dir, nil)
		switch {
		case err != nil:
			res.Status = Failed
			res.Err = err
		case out.OK:
			res.Status = Passed
		default:
			res.Status = Failed
			res.Output = out.Output()
			res.Err = fmt.Errorf("код %d", out.Code)
		}
	}

	res.Duration = time.Since(started)
	if gate.Optional && res.Status == Failed {
		// Необязательная проверка сообщает о себе, но не валит прогон.
		res.Status = Skipped
	}
	// Кэшируем только успех: неудачу пересдают, а не запоминают.
	if cacheable && (res.Status == Passed) {
		cache.put(gate.Name, key)
	}
	return res
}

// measure считает вес собранного.
func measure(root string, gate Check) CheckResult {
	res := CheckResult{Name: gate.Name, Max: gate.Size.Max}

	files, err := sizes(filepath.Join(root, gate.Size.Path), gate.Size.Gzip)
	if err != nil {
		res.Status = Failed
		res.Err = fmt.Errorf("нечего мерить по пути %q: %w", gate.Size.Path, err)
		return res
	}

	for _, f := range files {
		res.Size += f.Size
	}
	if res.Size > gate.Size.Max {
		res.Status = Failed
		sort.Slice(files, func(i, j int) bool { return files[i].Size > files[j].Size })
		if len(files) > 5 {
			files = files[:5]
		}
		res.Largest = files
		res.Err = fmt.Errorf("%s из %s", FormatSize(res.Size), FormatSize(gate.Size.Max))
		return res
	}

	res.Status = Passed
	return res
}

// sizes измеряет файл или всё содержимое каталога.
//
// При gzip каждый файл сжимается отдельно — именно так их отдаст сервер.
// Сжать всё одним потоком значило бы получить цифру лучше настоящей.
func sizes(path string, gzipped bool) ([]FileSize, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	var out []FileSize
	add := func(p string) error {
		n, err := weigh(p, gzipped)
		if err != nil {
			return err
		}
		out = append(out, FileSize{Path: p, Size: n})
		return nil
	}

	if !st.IsDir() {
		return out, add(path)
	}

	err = filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		return add(p)
	})
	return out, err
}

func weigh(path string, gzipped bool) (int64, error) {
	if !gzipped {
		st, err := os.Stat(path)
		if err != nil {
			return 0, err
		}
		return st.Size(), nil
	}

	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	counter := &counting{}
	zw, err := gzip.NewWriterLevel(counter, gzip.BestCompression)
	if err != nil {
		return 0, err
	}
	if _, err := io.Copy(zw, f); err != nil {
		return 0, err
	}
	if err := zw.Close(); err != nil {
		return 0, err
	}
	return counter.n, nil
}

type counting struct{ n int64 }

func (c *counting) Write(p []byte) (int, error) {
	c.n += int64(len(p))
	return len(p), nil
}

// checkCache помнит, что уже проходило и на каких файлах.
//
// Ключ считается по содержимому входов, а не по времени изменения: mtime меняется
// при обычном git checkout, и кэш обесценивался бы после каждого переключения
// ветки, хотя файлы те же самые.
type checkCache struct {
	enabled bool
	path    string
	Entries map[string]string `json:"entries"`
	mu      sync.Mutex
	dirty   bool
}

func loadCache(root string, enabled bool) *checkCache {
	c := &checkCache{enabled: enabled, Entries: map[string]string{}}
	if !enabled {
		return c
	}

	dir, err := os.UserCacheDir()
	if err != nil {
		c.enabled = false
		return c
	}
	// Кэш живёт вне проекта: подкладывать служебные каталоги в чужой репозиторий
	// без спроса — плохая манера.
	sum := sha256.Sum256([]byte(root))
	c.path = filepath.Join(dir, "p3k", hex.EncodeToString(sum[:8])+".json")

	if data, err := os.ReadFile(c.path); err == nil {
		json.Unmarshal(data, c)
	}
	return c
}

// key считает отпечаток проверки: команда плюс содержимое её входов.
//
// Второе возвращаемое значение — можно ли вообще кэшировать. Без входов
// нельзя: не зная, от чего результат зависит, мы не вправе утверждать, что
// ничего не изменилось.
func (c *checkCache) key(root string, gate Check) (string, bool) {
	if !c.enabled || len(gate.Inputs) == 0 {
		return "", false
	}

	h := sha256.New()
	fmt.Fprintf(h, "%s\x00%s\x00", gate.Command, gate.Dir)
	if gate.Size != nil {
		fmt.Fprintf(h, "%s\x00%d\x00%t\x00", gate.Size.Path, gate.Size.Max, gate.Size.Gzip)
	}

	for _, input := range gate.Inputs {
		full := filepath.Join(root, input)
		err := filepath.WalkDir(full, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			f, err := os.Open(p)
			if err != nil {
				return err
			}
			defer f.Close()

			rel, _ := filepath.Rel(root, p)
			io.WriteString(h, filepath.ToSlash(rel))
			io.WriteString(h, "\x00")
			_, err = io.Copy(h, f)
			return err
		})
		if err != nil {
			// Не прочитали вход — не знаем состояния, значит не кэшируем.
			return "", false
		}
	}
	return hex.EncodeToString(h.Sum(nil)), true
}

func (c *checkCache) hit(name, key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Entries[name] == key
}

func (c *checkCache) put(name, key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Entries[name] = key
	c.dirty = true
}

func (c *checkCache) save() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.enabled || !c.dirty || c.path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0o755); err != nil {
		return
	}
	data, err := json.Marshal(c)
	if err != nil {
		return
	}
	// Кэш — не то, ради чего стоит валить прогон: не записался и не записался.
	os.WriteFile(c.path, data, 0o644)
}
