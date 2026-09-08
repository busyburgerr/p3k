// Пакет p3k описывает окружение проекта одним файлом и поднимает его.
//
// Это библиотека, а не обёртка над консольной утилитой: окружение поднимается
// внутри вашей программы, и вы держите его в руках — можете дождаться
// готовности, узнать адрес поднятой базы и погасить всё в конце.
//
// Самый частый случай — интеграционные тесты, которым нужны настоящие база и
// кэш, а не заглушки:
//
//	func TestMain(m *testing.M) {
//	    cfg, err := p3k.Load("p3k.json")
//	    if err != nil {
//	        log.Fatal(err)
//	    }
//	    env := p3k.New(cfg)
//
//	    ctx := context.Background()
//	    if err := env.Start(ctx); err != nil {
//	        log.Fatal(err)
//	    }
//	    code := m.Run()
//	    env.Stop(ctx)
//	    os.Exit(code)
//	}
//
// Start возвращается не тогда, когда процессы запущены, а когда каждый из них
// начал отвечать: порт принимает соединение, HTTP отдаёт статус ниже 500,
// команда завершилась успехом. Разница между «запустили» и «отвечает» — это
// почти все плавающие падения интеграционных тестов.
//
// Зависимостей у библиотеки нет: только стандартная библиотека.
package p3k

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Имена, под которыми ищется конфиг проекта.
var ConfigNames = []string{"p3k.json", "p3k.config.json"}

// Config — разобранный p3k.json.
//
// Поля независимы: программе, которой нужны только процессы, остальные секции
// не мешают, а их отсутствие не ошибка.
type Config struct {
	// Path — файл, из которого прочитан конфиг.
	Path string
	// Root — каталог проекта: пути в конфиге считаются от него.
	Root string

	Processes []Process
	Checks    []Check
	// Resources — реестр ресурсов, добавленных командой add. Нужен, чтобы
	// отличать процессы инструмента от процессов проекта и чтобы собрать
	// продакшен-манифест.
	Resources map[string]ResourceRef
	Deploy    *Deploy
}

// ResourceRef — запись о ресурсе в конфиге: чем он является и на каких портах.
type ResourceRef struct {
	Type  string         `json:"type"`
	Ports map[string]int `json:"ports"`
}

// Error — ошибка в конфиге. Всегда называет место: файл и путь до поля.
type Error struct {
	Where string
	Msg   string
}

func (e *Error) Error() string { return e.Where + ": " + e.Msg }

func errf(where, format string, a ...any) error {
	return &Error{Where: where, Msg: fmt.Sprintf(format, a...)}
}

// Find ищет конфиг в dir и выше по дереву — до корня файловой системы.
//
// Так утилита ведёт себя привычно: её можно звать из подкаталога проекта.
// Возвращает os.ErrNotExist, если ничего не нашлось.
func Find(dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	for {
		for _, name := range ConfigNames {
			path := filepath.Join(abs, name)
			if st, err := os.Stat(path); err == nil && !st.IsDir() {
				return path, nil
			}
		}
		up := filepath.Dir(abs)
		if up == abs {
			return "", fmt.Errorf("конфиг не найден в %s и выше: %w", dir, os.ErrNotExist)
		}
		abs = up
	}
}

// Load читает и разбирает конфиг по точному пути.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("не прочитали конфиг: %w", err)
	}
	return Parse(data, path)
}

// LoadDir находит конфиг начиная с dir и разбирает его.
func LoadDir(dir string) (*Config, error) {
	path, err := Find(dir)
	if err != nil {
		return nil, err
	}
	return Load(path)
}

// raw — форма конфига как она лежит в JSON.
type raw struct {
	Processes map[string]json.RawMessage `json:"processes"`
	Checks    map[string]json.RawMessage `json:"checks"`
	Resources map[string]ResourceRef     `json:"resources"`
	Deploy    json.RawMessage            `json:"deploy"`
}

// Parse разбирает содержимое конфига. path нужен только для сообщений об
// ошибках и для вычисления корня проекта.
func Parse(data []byte, path string) (*Config, error) {
	var r raw
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, errf(path, "не разобрали JSON — %v", err)
	}

	cfg := &Config{
		Path:      path,
		Root:      filepath.Dir(path),
		Resources: r.Resources,
	}
	if cfg.Resources == nil {
		cfg.Resources = map[string]ResourceRef{}
	}

	// Порядок ключей в JSON не сохраняется, а выводить процессы вразнобой при
	// каждом запуске неприятно: сортируем по имени. На порядок запуска это не
	// влияет — его задаёт граф зависимостей.
	for _, name := range sortedKeys(r.Processes) {
		p, err := parseProcess(name, r.Processes[name], fmt.Sprintf("%s → processes.%s", path, name))
		if err != nil {
			return nil, err
		}
		cfg.Processes = append(cfg.Processes, *p)
	}
	if err := checkNeeds(cfg.Processes, path); err != nil {
		return nil, err
	}

	for _, name := range sortedKeys(r.Checks) {
		c, err := parseCheck(name, r.Checks[name], fmt.Sprintf("%s → checks.%s", path, name))
		if err != nil {
			return nil, err
		}
		cfg.Checks = append(cfg.Checks, *c)
	}

	if len(r.Deploy) > 0 {
		d, err := parseDeploy(r.Deploy, path+" → deploy")
		if err != nil {
			return nil, err
		}
		cfg.Deploy = d
	}

	return cfg, nil
}

// Process возвращает процесс по имени.
func (c *Config) Process(name string) (*Process, bool) {
	for i := range c.Processes {
		if c.Processes[i].Name == name {
			return &c.Processes[i], true
		}
	}
	return nil, false
}

// IsResource сообщает, добавлен ли процесс командой add, — в отличие от
// процессов самого проекта.
func (c *Config) IsResource(name string) bool {
	_, ok := c.Resources[name]
	return ok
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
