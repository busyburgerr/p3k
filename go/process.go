package p3k

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Process — один кусок окружения: база, сборка, приложение.
type Process struct {
	Name string
	// Command выполняется через оболочку: человек пишет её привычно, с
	// кавычками и конвейерами, и разбирать её самим значило бы делать вид,
	// что мы оболочка, и расходиться с ней на первом же непростом случае.
	Command string
	// Dir — рабочий каталог, относительно корня проекта.
	Dir string
	Env map[string]string
	// Needs — процессы, которые должны стать готовыми раньше этого.
	Needs []string
	// Ready — условие, после которого процесс считается готовым.
	// nil означает «готов сразу после запуска».
	Ready Ready
	// OneShot — процесс должен отработать и завершиться: миграции,
	// кодогенерация, docker compose up -d. Его выход не повод гасить окружение,
	// а готовность — это успешный выход, а не открытый порт.
	OneShot bool
	// Stop — команда корректной остановки для того, что переживает смерть
	// родителя. Контейнер, поднятый через docker run, — ровно такой случай.
	Stop string
}

type rawProcess struct {
	Command string          `json:"command"`
	Dir     string          `json:"cwd"`
	Env     map[string]any  `json:"env"`
	Needs   []string        `json:"needs"`
	Ready   json.RawMessage `json:"ready"`
	OneShot bool            `json:"oneShot"`
	Stop    string          `json:"stop"`
}

func parseProcess(name string, data []byte, where string) (*Process, error) {
	var r rawProcess
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, errf(where, "ожидался объект — %v", err)
	}
	if strings.TrimSpace(r.Command) == "" {
		return nil, errf(where+".command", "обязательная непустая строка")
	}

	p := &Process{
		Name:    name,
		Command: r.Command,
		Dir:     r.Dir,
		Needs:   r.Needs,
		OneShot: r.OneShot,
		Stop:    r.Stop,
	}

	if r.Env != nil {
		p.Env = make(map[string]string, len(r.Env))
		for k, v := range r.Env {
			s, err := scalar(v)
			if err != nil {
				return nil, errf(where+".env."+k, "%v", err)
			}
			p.Env[k] = s
		}
	}

	if len(r.Ready) > 0 {
		ready, err := parseReady(r.Ready, where+".ready")
		if err != nil {
			return nil, err
		}
		p.Ready = ready
	}

	return p, nil
}

// scalar приводит значение переменной окружения к строке.
//
// Числа в JSON пишут по привычке — "PORT": 4000, — и отвергать их значило бы
// придираться там, где намерение очевидно. Всё остальное отвергается: массив
// или объект в переменной окружения почти наверняка описка.
func scalar(v any) (string, error) {
	switch t := v.(type) {
	case string:
		return t, nil
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t)), nil
		}
		return fmt.Sprintf("%v", t), nil
	case bool:
		return fmt.Sprintf("%t", t), nil
	default:
		return "", fmt.Errorf("значение должно быть строкой или числом")
	}
}

func checkNeeds(procs []Process, where string) error {
	known := make(map[string]bool, len(procs))
	for _, p := range procs {
		known[p.Name] = true
	}
	for _, p := range procs {
		for _, n := range p.Needs {
			if n == p.Name {
				return errf(fmt.Sprintf("%s → processes.%s.needs", where, p.Name), "процесс зависит сам от себя")
			}
			if !known[n] {
				return errf(fmt.Sprintf("%s → processes.%s.needs", where, p.Name), "нет процесса %q", n)
			}
		}
	}
	return nil
}

// rawReady — условие готовности в том виде, в каком оно лежит в JSON.
type rawReady struct {
	Port   *int     `json:"port"`
	HTTP   *string  `json:"http"`
	Status *int     `json:"status"`
	Exec   *string  `json:"exec"`
	Log    *string  `json:"log"`
	Delay  *float64 `json:"delay"`
}

func parseReady(data []byte, where string) (Ready, error) {
	var r rawReady
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, errf(where, "ожидался объект — %v", err)
	}

	switch {
	case r.Port != nil:
		if *r.Port < 1 || *r.Port > 65535 {
			return nil, errf(where+".port", "номер порта вне диапазона 1..65535")
		}
		return Port(*r.Port), nil

	case r.HTTP != nil:
		if !strings.HasPrefix(*r.HTTP, "http://") && !strings.HasPrefix(*r.HTTP, "https://") {
			return nil, errf(where+".http", "ожидался URL со схемой http или https")
		}
		h := HTTP{URL: *r.HTTP}
		if r.Status != nil {
			h.Status = *r.Status
		}
		return h, nil

	case r.Exec != nil:
		if strings.TrimSpace(*r.Exec) == "" {
			return nil, errf(where+".exec", "пустая строка")
		}
		return Exec(*r.Exec), nil

	case r.Log != nil:
		if *r.Log == "" {
			return nil, errf(where+".log", "пустая строка")
		}
		return Log(*r.Log), nil

	case r.Delay != nil:
		if *r.Delay <= 0 {
			return nil, errf(where+".delay", "ожидались миллисекунды числом больше нуля")
		}
		return Delay(time.Duration(*r.Delay) * time.Millisecond), nil
	}

	return nil, errf(where, "ожидалось одно из { port } | { http } | { exec } | { log } | { delay }")
}
