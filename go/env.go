package p3k

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/busyburgerr/p3k/go/internal/procgroup"
	"github.com/busyburgerr/p3k/go/internal/shell"
)

// Env — поднятое окружение проекта.
//
// Один Env — один цикл жизни: Start поднимает, Stop гасит. Повторно
// использовать его после Stop нельзя, да и незачем: создайте новый.
type Env struct {
	cfg   *Config
	procs []Process
	opts  options

	mu      sync.Mutex
	state   map[string]*procState
	order   [][]Process
	started bool
	stopped bool

	// death закрывается, когда завершился процесс, который завершаться не должен.
	death     chan struct{}
	deathOnce sync.Once
	deathWho  string
	deathErr  error

	out *mux
}

type procState struct {
	spec    Process
	cmd     *exec.Cmd
	release func()
	tail    *tail
	dir     string
	environ []string

	mu     sync.Mutex
	exited bool
	err    error
	waited chan struct{}
}

type options struct {
	out          io.Writer
	only         []string
	env          map[string]string
	readyTimeout time.Duration
	stopGrace    time.Duration
	ready        map[string]Ready
}

// Option настраивает окружение при создании.
type Option func(*options)

// WithOutput направляет вывод процессов в w. По умолчанию вывод никуда не идёт:
// библиотеке не подобает печатать в чужой stdout без спроса.
//
// В тестах удобно передать os.Stdout только при -v, а иначе оставить пустым.
func WithOutput(w io.Writer) Option { return func(o *options) { o.out = w } }

// WithOnly поднимает только названные процессы — и всё, от чего они зависят.
//
// Замыкание по зависимостям добавляется само: поднять «только приложение» без
// его базы всё равно не получится.
func WithOnly(names ...string) Option { return func(o *options) { o.only = names } }

// WithEnv добавляет переменные всем процессам. Значения из конфига важнее:
// то, что написано в проекте, не должно молча подменяться извне.
func WithEnv(env map[string]string) Option { return func(o *options) { o.env = env } }

// WithReadyTimeout ограничивает ожидание готовности одного процесса.
// По умолчанию — две минуты: первый запуск MySQL укладывается, зависший — нет.
func WithReadyTimeout(d time.Duration) Option { return func(o *options) { o.readyTimeout = d } }

// WithStopGrace задаёт, сколько ждать после вежливой просьбы завершиться,
// прежде чем снимать дерево принудительно.
func WithStopGrace(d time.Duration) Option { return func(o *options) { o.stopGrace = d } }

// WithReady подменяет условие готовности процесса.
//
// Нужно, когда готовность определяется по-своему: очередь пуста, миграция
// применена, в базе появилась таблица.
func WithReady(process string, r Ready) Option {
	return func(o *options) {
		if o.ready == nil {
			o.ready = map[string]Ready{}
		}
		o.ready[process] = r
	}
}

// New готовит окружение по конфигу, ничего не запуская.
func New(cfg *Config, opts ...Option) *Env {
	o := options{readyTimeout: 2 * time.Minute, stopGrace: 5 * time.Second}
	for _, apply := range opts {
		apply(&o)
	}

	procs := cfg.Processes
	if len(o.only) > 0 {
		procs = WithNeeds(procs, o.only)
	}

	names := make([]string, 0, len(procs))
	for _, p := range procs {
		names = append(names, p.Name)
	}

	return &Env{
		cfg:   cfg,
		procs: procs,
		opts:  o,
		state: map[string]*procState{},
		death: make(chan struct{}),
		out:   newMux(o.out, names),
	}
}

// Processes — имена процессов, которыми окружение распоряжается, в порядке
// запуска.
func (e *Env) Processes() []string {
	names := make([]string, 0, len(e.procs))
	for _, p := range e.procs {
		names = append(names, p.Name)
	}
	return names
}

// Start поднимает окружение волнами и возвращается, когда всё готово.
//
// Готово означает именно готово: каждый процесс выполнил своё условие. Если
// хоть один не смог, уже поднятое гасится, и Start возвращает ошибку — иначе
// вызывающий получил бы наполовину живое окружение и разбирался бы с ним сам.
//
// Контекст ограничивает подъём целиком. После возврата Start он больше ни на
// что не влияет: временем жизни окружения распоряжается Stop.
func (e *Env) Start(ctx context.Context) error {
	e.mu.Lock()
	if e.started {
		e.mu.Unlock()
		return errors.New("окружение уже поднято")
	}
	e.started = true
	e.mu.Unlock()

	if len(e.procs) == 0 {
		return errors.New("в конфиге нет ни одного процесса")
	}
	if bad := UnknownNeeds(e.procs); len(bad) > 0 {
		return fmt.Errorf("ссылки на неизвестные процессы: %s", strings.Join(bad, ", "))
	}

	waves, err := Waves(e.procs)
	if err != nil {
		return err
	}
	e.order = waves

	e.out.system(fmt.Sprintf("процессов: %d, волн запуска: %d", len(e.procs), len(waves)))

	for _, wave := range waves {
		if err := e.startWave(ctx, wave); err != nil {
			// Гасим тем же контекстом, но уже без ограничения по времени:
			// прибирать за собой нужно в любом случае, в том числе когда
			// подъём прервали по таймауту.
			stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			defer cancel()
			_ = e.Stop(stopCtx)
			return err
		}
	}

	e.out.system("всё поднято")
	return nil
}

func (e *Env) startWave(ctx context.Context, wave []Process) error {
	var wg sync.WaitGroup
	errs := make([]error, len(wave))

	for i, spec := range wave {
		i, spec := i, spec
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = e.startOne(ctx, spec)
		}()
	}
	wg.Wait()

	return errors.Join(errs...)
}

func (e *Env) startOne(ctx context.Context, spec Process) error {
	dir := e.cfg.Root
	if spec.Dir != "" {
		dir = filepath.Join(e.cfg.Root, spec.Dir)
	}
	environ := e.environFor(spec)

	cmd := shell.Detached(spec.Command, dir, environ)
	procgroup.Configure(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("%s: %w", spec.Name, err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("%s: %w", spec.Name, err)
	}

	st := &procState{
		spec:    spec,
		cmd:     cmd,
		tail:    &tail{},
		dir:     dir,
		environ: environ,
		waited:  make(chan struct{}),
	}

	e.mu.Lock()
	e.state[spec.Name] = st
	e.mu.Unlock()

	e.out.system(fmt.Sprintf("%s: запуск — %s", spec.Name, spec.Command))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%s: не запустился — %w", spec.Name, err)
	}

	release, adoptErr := procgroup.Adopt(cmd)
	st.release = release
	if adoptErr != nil {
		// Не повод останавливаться: процесс работает. Но снять мы сможем
		// только его самого, поэтому говорим об этом вслух.
		e.out.system(fmt.Sprintf("%s: надзор за деревом не установлен (%v) — потомки могут пережить остановку", spec.Name, adoptErr))
	}

	var pumps sync.WaitGroup
	pumps.Add(2)
	go func() { defer pumps.Done(); e.out.pump(spec.Name, stdout, st.tail) }()
	go func() { defer pumps.Done(); e.out.pump(spec.Name, stderr, st.tail) }()

	go func() {
		// Ждём, пока вывод дочитан: иначе последние строки процесса пропали бы
		// ровно тогда, когда они нужнее всего — при падении.
		pumps.Wait()
		err := cmd.Wait()

		st.mu.Lock()
		st.exited = true
		st.err = err
		st.mu.Unlock()
		close(st.waited)

		e.noteExit(spec, err)
	}()

	return e.waitReady(ctx, spec, st)
}

func (e *Env) waitReady(ctx context.Context, spec Process, st *procState) error {
	ready := e.readyFor(spec)

	ctx, cancel := context.WithTimeout(ctx, e.opts.readyTimeout)
	defer cancel()

	if err := ready.Wait(ctx, st); err != nil {
		out := strings.TrimSpace(st.tail.String())
		if out != "" {
			out = "\n" + lastLines(out, 10)
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("%s: не стал готовым за %s (%s)%s", spec.Name, e.opts.readyTimeout, ready, out)
		}
		return fmt.Errorf("%s: %w (%s)%s", spec.Name, err, ready, out)
	}

	e.out.system(fmt.Sprintf("%s: готов (%s)", spec.Name, ready))
	return nil
}

// readyFor выбирает условие готовности: заданное вызывающим, затем из конфига,
// затем подразумеваемое.
func (e *Env) readyFor(spec Process) Ready {
	if r, ok := e.opts.ready[spec.Name]; ok {
		return r
	}
	if spec.Ready != nil {
		return spec.Ready
	}
	if spec.OneShot {
		return Succeeded{}
	}
	return Immediate{}
}

func (e *Env) environFor(spec Process) []string {
	merged := map[string]string{}
	for k, v := range e.opts.env {
		merged[k] = v
	}
	// Конфиг проекта важнее переданного извне: то, что написано в проекте,
	// не должно молча подменяться.
	for k, v := range spec.Env {
		merged[k] = v
	}

	environ := os.Environ()
	for _, k := range sortedKeys(merged) {
		environ = append(environ, k+"="+merged[k])
	}
	return environ
}

// noteExit решает, обычное это завершение или гибель окружения.
func (e *Env) noteExit(spec Process, err error) {
	e.mu.Lock()
	stopping := e.stopped
	e.mu.Unlock()

	switch {
	case stopping:
		return
	case spec.OneShot:
		if err != nil {
			e.out.system(fmt.Sprintf("%s: разовый шаг завершился неудачно — %v", spec.Name, err))
		}
		return
	}

	if err != nil {
		e.out.system(fmt.Sprintf("%s: завершился — %v", spec.Name, err))
	} else {
		e.out.system(fmt.Sprintf("%s: завершился сам", spec.Name))
	}

	e.deathOnce.Do(func() {
		e.deathWho = spec.Name
		e.deathErr = err
		close(e.death)
	})
}

// Wait ждёт, пока окружение не развалится.
//
// Возвращает ошибку, когда завершился долгоживущий процесс: для окружения это
// смерть, даже если код возврата нулевой. Возвращает nil, если раньше позвали
// Stop, и ошибку контекста, если тот истёк.
//
// Так пишется дев-сервер: поднять, дождаться беды или сигнала, погасить.
func (e *Env) Wait(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-e.death:
		if e.deathErr != nil {
			return fmt.Errorf("процесс %q завершился: %w", e.deathWho, e.deathErr)
		}
		return fmt.Errorf("процесс %q завершился сам", e.deathWho)
	}
}

// Stop гасит окружение в порядке, обратном запуску.
//
// Приложение уходит раньше базы: наоборот — значит гарантированно получить в
// логах ошибки подключения напоследок.
//
// Stop идемпотентен и безопасен даже после неудачного Start: он погасит то,
// что успело подняться. Ошибки отдельных процессов собираются вместе — одна
// упрямая служба не должна помешать погасить остальные.
func (e *Env) Stop(ctx context.Context) error {
	e.mu.Lock()
	if e.stopped {
		e.mu.Unlock()
		return nil
	}
	e.stopped = true
	order := e.order
	e.mu.Unlock()

	if len(order) == 0 {
		// Start не дошёл до раскладки по волнам — гасим то, что есть, в
		// обратном порядке объявления.
		order = [][]Process{e.procs}
	}

	var errs []error
	for _, wave := range Reverse(order) {
		// Внутри волны процессы друг от друга не зависят: гасим разом.
		var wg sync.WaitGroup
		waveErrs := make([]error, len(wave))
		for i, spec := range wave {
			i, spec := i, spec
			wg.Add(1)
			go func() {
				defer wg.Done()
				waveErrs[i] = e.stopOne(ctx, spec)
			}()
		}
		wg.Wait()
		errs = append(errs, waveErrs...)
	}

	e.out.system("остановлено")
	return errors.Join(errs...)
}

func (e *Env) stopOne(ctx context.Context, spec Process) error {
	e.mu.Lock()
	st := e.state[spec.Name]
	e.mu.Unlock()
	if st == nil {
		return nil
	}

	// Команду остановки выполняем и для уже завершившихся процессов.
	// `docker compose up -d` выходит сразу, а контейнеры продолжают жить: без
	// этого они пережили бы окружение и заняли порты до следующего запуска.
	if spec.Stop != "" {
		e.out.system(fmt.Sprintf("%s: %s", spec.Name, spec.Stop))
		res, err := shell.Run(ctx, spec.Stop, st.dir, st.environ)
		if err != nil {
			return fmt.Errorf("%s: команда остановки не запустилась — %w", spec.Name, err)
		}
		if !res.OK {
			return fmt.Errorf("%s: команда остановки вернула %d — %s", spec.Name, res.Code, res.Tail(3))
		}
	}

	if st.hasExited() {
		if st.release != nil {
			st.release()
		}
		return nil
	}

	err := e.stopTree(ctx, st)
	if st.release != nil {
		st.release()
	}
	return err
}

func (e *Env) stopTree(ctx context.Context, st *procState) error {
	// Сначала вежливо. Там, где вежливость не работает вовсе, procgroup
	// говорит об этом сразу — и ждать смысла нет.
	grace := e.opts.stopGrace
	if err := procgroup.Terminate(st.cmd); err != nil {
		if errors.Is(err, procgroup.ErrNoSoftStop) {
			grace = 0
		}
	}

	if grace > 0 {
		select {
		case <-st.waited:
			return nil
		case <-ctx.Done():
		case <-time.After(grace):
		}
	}

	if err := procgroup.Kill(st.cmd); err != nil {
		return fmt.Errorf("%s: не сняли дерево процессов — %w", st.spec.Name, err)
	}

	select {
	case <-st.waited:
	case <-time.After(5 * time.Second):
		return fmt.Errorf("%s: дерево не завершилось после снятия", st.spec.Name)
	}
	return nil
}

// Output возвращает всё, что процесс напечатал.
//
// Полезно в тестах: когда проверка упала, лог приложения — первое, что хочется
// увидеть, и идти за ним в чужой stdout не надо.
func (e *Env) Output(name string) string {
	e.mu.Lock()
	st := e.state[name]
	e.mu.Unlock()
	if st == nil {
		return ""
	}
	return st.tail.String()
}

// Running — процессы, которые сейчас работают.
func (e *Env) Running() []string {
	e.mu.Lock()
	defer e.mu.Unlock()

	var names []string
	for name, st := range e.state {
		if !st.hasExited() {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

func (s *procState) hasExited() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exited
}

// Probe: procState отдаёт условиям готовности то, что они спрашивают.

func (s *procState) Dir() string       { return s.dir }
func (s *procState) Environ() []string { return s.environ }
func (s *procState) Output() string    { return s.tail.String() }

func (s *procState) Exited() (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exited, s.err
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	for i := range lines {
		lines[i] = "    " + lines[i]
	}
	return strings.Join(lines, "\n")
}
