package p3k

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/busyburgerr/p3k/go/internal/shell"
)

// releaseIDPattern — имя выпуска: время в UTC, при совпадении с порядковым
// номером. Отсортированные по алфавиту, такие имена идут в порядке времени.
var releaseIDPattern = regexp.MustCompile(`^\d{8}-\d{6}(?:-\d{2})?$`)

// ReleaseID — имя выпуска для указанного момента.
func ReleaseID(t time.Time) string {
	t = t.UTC()
	return fmt.Sprintf("%04d%02d%02d-%02d%02d%02d",
		t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second())
}

// UniqueRelease возвращает имя, которого на цели ещё нет.
//
// Две выкатки в одну секунду — не выдумка: так выглядит повторный запуск после
// опечатки. Без этого второй выпуск лёг бы поверх первого, и откатываться было
// бы уже некуда. Порядковый номер дополняется нулём, чтобы имена продолжали
// сортироваться по алфавиту так же, как по времени.
func UniqueRelease(taken []string, base string) (string, error) {
	busy := make(map[string]bool, len(taken))
	for _, name := range taken {
		busy[name] = true
	}
	if !busy[base] {
		return base, nil
	}
	for i := 2; i < 100; i++ {
		id := fmt.Sprintf("%s-%02d", base, i)
		if !busy[id] {
			return id, nil
		}
	}
	return "", errors.New("сто выпусков за одну секунду — что-то пошло не так")
}

// ShipReport — что произошло при выкатке.
type ShipReport struct {
	// Target — куда выкатывали.
	Target string
	// Release — имя нового выпуска.
	Release string
	// Previous — что работало до этого. Пусто, если выпуск первый.
	Previous string
	// RolledBack — выпуск не прошёл проверку здоровья, и ссылка вернулась назад.
	RolledBack bool
	// Healthy — приложение ответило после переключения.
	Healthy bool
	// Steps — сколько заняли шаги.
	Steps []ShipStep
	// Pruned — сколько старых выпусков убрано.
	Pruned int
}

// ShipStep — один шаг выкатки.
type ShipStep struct {
	Name     string
	Duration time.Duration
	Detail   string
}

type shipOptions struct {
	target   Target
	out      io.Writer
	checks   *bool
	rollback bool
	dryRun   bool
	now      time.Time
}

// ShipOption настраивает выкатку.
type ShipOption func(*shipOptions)

// WithTarget подменяет цель, выбранную по конфигу.
func WithTarget(t Target) ShipOption { return func(o *shipOptions) { o.target = t } }

// WithShipOutput пишет ход выкатки в w.
func WithShipOutput(w io.Writer) ShipOption { return func(o *shipOptions) { o.out = w } }

// WithoutShipChecks пропускает проверки перед выкаткой.
func WithoutShipChecks() ShipOption {
	return func(o *shipOptions) { no := false; o.checks = &no }
}

// WithoutRollback оставляет нездоровый выпуск на цели вместо отката.
//
// Иногда это нужно: чтобы посмотреть на сломанное приложение живьём. Но по
// умолчанию ссылка возвращается назад — работающий сайт важнее удобства
// разбирательства.
func WithoutRollback() ShipOption { return func(o *shipOptions) { o.rollback = false } }

// DryRun показывает план и проверяет связь, ничего не меняя.
func DryRun() ShipOption { return func(o *shipOptions) { o.dryRun = true } }

// paths — раскладка на цели.
type shipPaths struct {
	base     string
	releases string
	current  string
	shared   string
}

func layout(t Target, base string) shipPaths {
	return shipPaths{
		base:     base,
		releases: t.Join(base, "releases"),
		current:  t.Join(base, "current"),
		shared:   t.Join(base, "shared"),
	}
}

func prepare(cfg *Config, opts []ShipOption) (*Deploy, Target, shipPaths, shipOptions, error) {
	o := shipOptions{rollback: true, now: time.Now()}
	for _, apply := range opts {
		apply(&o)
	}

	if cfg.Deploy == nil {
		return nil, nil, shipPaths{}, o, errors.New("в конфиге нет секции deploy — описывать выкатку негде")
	}
	target := o.target
	if target == nil {
		target = TargetFor(cfg.Deploy)
	}
	return cfg.Deploy, target, layout(target, cfg.Deploy.Path), o, nil
}

func say(o shipOptions, format string, a ...any) {
	if o.out != nil {
		fmt.Fprintf(o.out, format+"\n", a...)
	}
}

// Releases перечисляет выпуски на цели, от старых к новым, и говорит, какой
// из них сейчас работает.
func Releases(ctx context.Context, cfg *Config, opts ...ShipOption) ([]string, string, error) {
	_, target, p, _, err := prepare(cfg, opts)
	if err != nil {
		return nil, "", err
	}
	if err := target.Probe(ctx); err != nil {
		return nil, "", err
	}
	list, err := releaseList(ctx, target, p)
	if err != nil {
		return nil, "", err
	}
	current, err := currentRelease(ctx, target, p)
	return list, current, err
}

func releaseList(ctx context.Context, t Target, p shipPaths) ([]string, error) {
	names, err := t.List(ctx, p.releases)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, name := range names {
		if releaseIDPattern.MatchString(name) {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out, nil
}

func currentRelease(ctx context.Context, t Target, p shipPaths) (string, error) {
	link, err := t.ReadLink(ctx, p.current)
	if err != nil || link == "" {
		return "", err
	}
	name := filepath.Base(strings.TrimRight(strings.ReplaceAll(link, "\\", "/"), "/"))
	if !releaseIDPattern.MatchString(name) {
		return "", nil
	}
	return name, nil
}

// switchTo переключает ссылку и перезапускает службу.
func switchTo(ctx context.Context, t Target, p shipPaths, d *Deploy, name string) error {
	if err := t.Link(ctx, t.Join(p.releases, name), p.current); err != nil {
		return err
	}
	if d.Restart == "" {
		return nil
	}
	res, err := t.Run(ctx, d.Restart, p.current)
	if err != nil {
		return fmt.Errorf("перезапуск не запустился: %w", err)
	}
	if !res.OK {
		return fmt.Errorf("перезапуск не отработал: %s", res.Tail(6))
	}
	return nil
}

// waitHealthy опрашивает приложение, пока оно не ответит.
//
// Сразу после перезапуска отказ — норма: служба ещё поднимается. Поэтому
// спрашиваем до истечения срока и только тогда считаем выпуск негодным.
func waitHealthy(ctx context.Context, h *Health) error {
	client := &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	deadline := time.Now().Add(h.Timeout)
	last := "ответа не было"

	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.URL, nil)
		if err != nil {
			return fmt.Errorf("негодный адрес %q: %w", h.URL, err)
		}
		res, err := client.Do(req)
		if err == nil {
			res.Body.Close()
			ok := res.StatusCode < 500
			if h.Status != 0 {
				ok = res.StatusCode == h.Status
			}
			if ok {
				return nil
			}
			last = fmt.Sprintf("статус %d", res.StatusCode)
		} else {
			last = err.Error()
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("не отвечает: %s за %s", last, h.Timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// Rollback возвращает цель на предыдущий выпуск.
//
// Это не повторная выкатка: прошлый выпуск лежит рядом целиком, со своими
// зависимостями, поэтому возврат стоит ровно одного переключения ссылки.
func Rollback(ctx context.Context, cfg *Config, opts ...ShipOption) (*ShipReport, error) {
	d, target, p, o, err := prepare(cfg, opts)
	if err != nil {
		return nil, err
	}
	if err := target.Probe(ctx); err != nil {
		return nil, err
	}

	list, err := releaseList(ctx, target, p)
	if err != nil {
		return nil, err
	}
	active, err := currentRelease(ctx, target, p)
	if err != nil {
		return nil, err
	}

	index := -1
	for i, name := range list {
		if name == active {
			index = i
		}
	}
	switch {
	case active == "":
		return nil, errors.New("current никуда не указывает — откатываться не с чего")
	case index <= 0:
		return nil, fmt.Errorf("%s — самый ранний выпуск на цели, откатываться некуда", active)
	}

	target_ := list[index-1]
	say(o, "  откат: %s → %s", active, target_)
	if err := switchTo(ctx, target, p, d, target_); err != nil {
		return nil, err
	}

	report := &ShipReport{Target: target.Describe(), Release: target_, Previous: active, RolledBack: true}
	if d.Health != nil {
		if err := waitHealthy(ctx, d.Health); err != nil {
			return report, fmt.Errorf("откатились, но %s тоже нездоров: %w", target_, err)
		}
		report.Healthy = true
	}
	say(o, "  ✓ работает %s", target_)
	return report, nil
}

// Ship выкатывает проект.
//
// Новый выпуск заливается рядом с работающим, и только когда всё готово,
// ссылка current переключается на него. Если приложение после этого не
// отвечает, ссылка возвращается назад — поэтому неудачная выкатка не оставляет
// сайт сломанным.
//
// Отчёт возвращается и при неудаче: по нему видно, до какого шага дошли и был
// ли откат.
func Ship(ctx context.Context, cfg *Config, opts ...ShipOption) (*ShipReport, error) {
	d, target, p, o, err := prepare(cfg, opts)
	if err != nil {
		return nil, err
	}

	// Связь проверяем до всего остального: собирать проект десять минут, чтобы
	// потом узнать про недоступный сервер, — худший из возможных порядков.
	if err := target.Probe(ctx); err != nil {
		return nil, err
	}

	list, err := releaseList(ctx, target, p)
	if err != nil {
		return nil, err
	}
	name, err := UniqueRelease(list, ReleaseID(o.now))
	if err != nil {
		return nil, err
	}
	previous, err := currentRelease(ctx, target, p)
	if err != nil {
		return nil, err
	}

	report := &ShipReport{Target: target.Describe(), Release: name, Previous: previous}
	dir := target.Join(p.releases, name)

	say(o, "  %s · %s", target.Describe(), p.base)
	if previous == "" {
		say(o, "  выпуск %s · первый на этой цели", name)
	} else {
		say(o, "  выпуск %s · сейчас работает %s", name, previous)
	}

	project := projectName(cfg.Root)
	var compose *ComposePlan
	if d.Resources {
		compose = Compose(cfg.Resources, project)
	}

	if o.dryRun {
		say(o, "\n  План:")
		if d.Checks && (o.checks == nil || *o.checks) {
			say(o, "    проверки проекта")
		}
		if d.Build != "" {
			say(o, "    сборка: %s", d.Build)
		}
		say(o, "    отправка: %s → %s", strings.Join(d.Upload, ", "), dir)
		if compose != nil {
			say(o, "    службы: %s → %s", strings.Join(compose.Services, ", "), target.Join(p.shared, "compose.yml"))
			if len(compose.Skipped) > 0 {
				say(o, "    в прод не поедет: %s", strings.Join(compose.Skipped, ", "))
			}
		}
		if d.Release != "" {
			say(o, "    в выпуске: %s", d.Release)
		}
		say(o, "    переключение: %s → %s", p.current, dir)
		if d.Restart != "" {
			say(o, "    перезапуск: %s", d.Restart)
		}
		if d.Health != nil {
			say(o, "    здоровье: %s (до %s)", d.Health.URL, d.Health.Timeout)
		}
		say(o, "\n  Связь с целью есть. Ничего не изменено.")
		return report, nil
	}

	step := func(name string, fn func() error) error {
		started := time.Now()
		err := fn()
		report.Steps = append(report.Steps, ShipStep{Name: name, Duration: time.Since(started)})
		return err
	}

	if d.Checks && (o.checks == nil || *o.checks) {
		if err := step("проверки", func() error {
			checked, err := RunChecks(ctx, cfg, WithCheckOutput(o.out))
			if err != nil {
				// Проверок нет вовсе — это не повод отменять выкатку.
				say(o, "  · проверки пропущены: %v", err)
				return nil
			}
			if !checked.OK() {
				var names []string
				for _, f := range checked.Failed() {
					names = append(names, f.Name)
				}
				return fmt.Errorf("проверки не прошли (%s) — выкатка отменена", strings.Join(names, ", "))
			}
			return nil
		}); err != nil {
			return report, err
		}
	}

	if d.Build != "" {
		if err := step("сборка", func() error {
			say(o, "  · сборка: %s", d.Build)
			res, err := shell.Run(ctx, d.Build, cfg.Root, nil)
			if err != nil {
				return fmt.Errorf("сборка не запустилась: %w", err)
			}
			if !res.OK {
				return fmt.Errorf("сборка упала:\n%s", res.Tail(6))
			}
			return nil
		}); err != nil {
			return report, err
		}
		say(o, "  ✓ собрано")
	}

	for _, path := range d.Upload {
		if _, err := os.Stat(filepath.Join(cfg.Root, path)); err != nil {
			return report, fmt.Errorf("нечего отправлять: в проекте нет %q", path)
		}
	}

	if err := step("отправка", func() error {
		if err := target.Mkdir(ctx, dir); err != nil {
			return err
		}
		return target.Upload(ctx, cfg.Root, d.Upload, dir)
	}); err != nil {
		return report, err
	}
	say(o, "  ✓ отправлено: %s", strings.Join(d.Upload, ", "))

	if compose != nil {
		if len(compose.Skipped) > 0 {
			say(o, "  · в прод не поедет: %s", strings.Join(compose.Skipped, ", "))
		}
		if err := step("службы", func() error {
			return bringUp(ctx, target, p, compose, project, o)
		}); err != nil {
			say(o, "  Ничего не переключено — продолжает работать прежний выпуск.")
			return report, err
		}
		say(o, "  ✓ службы подняты: %s", strings.Join(compose.Services, ", "))
	}

	if d.Release != "" {
		if err := step("в выпуске", func() error {
			say(o, "  · в выпуске: %s", d.Release)
			res, err := target.Run(ctx, d.Release, dir)
			if err != nil {
				return err
			}
			if !res.OK {
				// Ссылку ещё не переключали: работает прежний выпуск, а
				// негодный остаётся на месте — с ним можно разобраться потом.
				return fmt.Errorf("не отработало:\n%s\n  Ничего не переключено, выпуск остался в %s",
					res.Tail(6), dir)
			}
			return nil
		}); err != nil {
			return report, err
		}
	}

	if err := step("переключение", func() error { return switchTo(ctx, target, p, d, name) }); err != nil {
		return report, err
	}
	say(o, "  ✓ current → %s", name)

	if d.Health != nil {
		healthErr := step("здоровье", func() error { return waitHealthy(ctx, d.Health) })
		if healthErr != nil {
			say(o, "  ✗ %v", healthErr)

			if !o.rollback || previous == "" {
				if previous == "" {
					return report, fmt.Errorf("%w; откатываться не на что: это первый выпуск", healthErr)
				}
				return report, fmt.Errorf("%w; откат отключён — на цели остался нездоровый выпуск", healthErr)
			}

			say(o, "  ↩ откат на %s", previous)
			if err := switchTo(ctx, target, p, d, previous); err != nil {
				return report, fmt.Errorf("%w; откат не удался: %v", healthErr, err)
			}
			report.RolledBack = true
			if err := waitHealthy(ctx, d.Health); err != nil {
				return report, fmt.Errorf("%w; откатились, но %s тоже не отвечает", healthErr, previous)
			}
			say(o, "  ✓ откатились, %s отвечает", previous)
			return report, fmt.Errorf("%w; откатились на %s, негодный выпуск остался в %s", healthErr, previous, dir)
		}
		report.Healthy = true
		say(o, "  ✓ здоров")
	}

	// Чистим только заведомо ненужное: текущий и предыдущий выпуски трогать
	// нельзя — на них держится откат.
	all, err := releaseList(ctx, target, p)
	if err == nil {
		keep := map[string]bool{name: true}
		if previous != "" {
			keep[previous] = true
		}
		from := len(all) - d.Keep
		for i, old := range all {
			if i < from && !keep[old] {
				if err := target.Remove(ctx, target.Join(p.releases, old)); err == nil {
					report.Pruned++
				}
			}
		}
	}
	if report.Pruned > 0 {
		say(o, "  ✓ убрано старых выпусков: %d", report.Pruned)
	}

	return report, nil
}

// bringUp поднимает ресурсы проекта на цели.
//
// Секреты остаются на сервере: мы отправляем только compose, а пароли берутся
// из shared/.env, который человек заполняет один раз сам. Поэтому первый запуск
// заканчивается отказом с готовым списком переменных — это не ошибка, а
// единственный шаг, который нельзя сделать за него.
func bringUp(ctx context.Context, t Target, p shipPaths, plan *ComposePlan, project string, o shipOptions) error {
	stage, err := os.MkdirTemp("", "p3k-shared-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)

	names := []string{"compose.yml"}
	if err := os.WriteFile(filepath.Join(stage, "compose.yml"), []byte(plan.YAML), 0o644); err != nil {
		return err
	}
	for name, content := range plan.Files {
		if err := os.WriteFile(filepath.Join(stage, name), []byte(content), 0o644); err != nil {
			return err
		}
		names = append(names, name)
	}

	if err := t.Mkdir(ctx, p.shared); err != nil {
		return err
	}

	envPath := t.Join(p.shared, ".env")
	exists, err := t.Exists(ctx, envPath)
	if err != nil {
		return err
	}
	if !exists {
		if err := os.WriteFile(filepath.Join(stage, ".env.example"), []byte(plan.EnvExample()), 0o644); err != nil {
			return err
		}
		if err := t.Upload(ctx, stage, append(names, ".env.example"), p.shared); err != nil {
			return err
		}
		say(o, "  Рядом положен .env.example. На сервере:")
		say(o, "    cp %s.example %s && отредактируйте", envPath, envPath)
		return fmt.Errorf("на сервере нет %s — заполните: %s",
			envPath, strings.Join(plan.Unfilled(), ", "))
	}

	if err := t.Upload(ctx, stage, names, p.shared); err != nil {
		return err
	}

	command := fmt.Sprintf("docker compose -p %s --env-file %s -f %s up -d --wait --remove-orphans",
		project, envPath, t.Join(p.shared, "compose.yml"))
	res, err := t.Run(ctx, command, p.shared)
	if err != nil {
		return err
	}
	if !res.OK {
		return fmt.Errorf("службы не поднялись:\n%s", res.Tail(6))
	}
	return nil
}

// projectName — имя проекта: из имени каталога, приведённое к безопасному виду.
// Оно попадает в имена контейнеров и в имя compose-проекта.
func projectName(root string) string {
	name := strings.ToLower(filepath.Base(root))
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-_")
	if out == "" {
		return "app"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}
