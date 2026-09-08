package p3k

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// Deploy — как выкатывать проект на сервер.
type Deploy struct {
	// Host — user@host для SSH. Пусто означает цель на этой же машине:
	// так удобно посмотреть, что получится, ничего не трогая на сервере.
	Host string
	// SSH — дополнительные аргументы ssh: порт, ключ.
	SSH []string
	// Path — корень выкатки на цели. Внутри появятся releases, shared и current.
	Path string
	// Build — команда сборки, выполняется локально до отправки.
	Build string
	// Upload — что отправлять, путями от корня проекта.
	Upload []string
	// Release — команда внутри нового выпуска до переключения:
	// установка зависимостей, миграции.
	Release string
	// Restart — команда после переключения.
	Restart string
	// Health — проверка, что приложение отвечает. Опрашивается с той машины,
	// откуда идёт выкатка, а не с сервера: адрес должен быть публичным.
	Health *Health
	// Keep — сколько прошлых выпусков хранить. Меньше двух означало бы, что
	// откатываться некуда.
	Keep int
	// Checks — прогонять ли проверки перед выкаткой.
	Checks bool
	// Resources — поднимать ли на сервере ресурсы проекта.
	Resources bool
}

// Health — чем подтверждается, что выпуск живой.
//
// Без этого выкатка означала бы «файлы доехали», а не «приложение работает»:
// ровно между этими двумя утверждениями и живут все ночные откаты.
type Health struct {
	URL string
	// Status — ожидаемый код. Ноль означает «любой ниже 500».
	Status int
	// Timeout — сколько ждать, пока приложение поднимется после перезапуска.
	Timeout time.Duration
}

type rawDeploy struct {
	Host      string          `json:"host"`
	SSH       []string        `json:"ssh"`
	Path      string          `json:"path"`
	Build     string          `json:"build"`
	Upload    []string        `json:"upload"`
	Release   string          `json:"release"`
	Restart   string          `json:"restart"`
	Health    json.RawMessage `json:"health"`
	Keep      *int            `json:"keep"`
	Checks    *bool           `json:"checks"`
	Resources *bool           `json:"resources"`
}

type rawHealth struct {
	URL     string   `json:"url"`
	Status  *int     `json:"status"`
	Timeout *float64 `json:"timeout"`
}

func parseDeploy(data []byte, where string) (*Deploy, error) {
	var r rawDeploy
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, errf(where, "ожидался объект — %v", err)
	}

	if strings.TrimSpace(r.Path) == "" {
		return nil, errf(where+".path", "обязательное поле — каталог выкатки на цели, например \"/srv/app\"")
	}
	if len(r.Upload) == 0 {
		return nil, errf(where+".upload", "обязательное поле — что отправлять, например [\"dist\", \"package.json\"]")
	}
	for _, p := range r.Upload {
		if err := insideProject(p); err != nil {
			return nil, errf(where+".upload", "%q — %v", p, err)
		}
	}

	d := &Deploy{
		Host:      r.Host,
		SSH:       r.SSH,
		Path:      r.Path,
		Build:     r.Build,
		Upload:    r.Upload,
		Release:   r.Release,
		Restart:   r.Restart,
		Keep:      5,
		Checks:    true,
		Resources: true,
	}

	if r.Keep != nil {
		if *r.Keep < 2 {
			return nil, errf(where+".keep", "ожидалось целое не меньше 2 — иначе откатываться будет некуда")
		}
		d.Keep = *r.Keep
	}
	if r.Checks != nil {
		d.Checks = *r.Checks
	}
	if r.Resources != nil {
		d.Resources = *r.Resources
	}

	if len(r.Health) > 0 {
		h, err := parseHealth(r.Health, where+".health")
		if err != nil {
			return nil, err
		}
		d.Health = h
	}

	return d, nil
}

func parseHealth(data []byte, where string) (*Health, error) {
	// Строкой — самая частая запись, и заставлять писать объект ради одного
	// адреса было бы придиркой.
	var url string
	if err := json.Unmarshal(data, &url); err == nil {
		if !isHTTPURL(url) {
			return nil, errf(where, "ожидался URL со схемой http или https")
		}
		return &Health{URL: url, Timeout: time.Minute}, nil
	}

	var r rawHealth
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, errf(where, "ожидался URL строкой или объект — %v", err)
	}
	if !isHTTPURL(r.URL) {
		return nil, errf(where+".url", "ожидался URL со схемой http или https")
	}

	h := &Health{URL: r.URL, Timeout: time.Minute}
	if r.Status != nil {
		h.Status = *r.Status
	}
	if r.Timeout != nil {
		if *r.Timeout <= 0 {
			return nil, errf(where+".timeout", "ожидались секунды числом больше нуля")
		}
		h.Timeout = time.Duration(*r.Timeout * float64(time.Second))
	}
	return h, nil
}

func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// insideProject отвергает пути, уводящие за пределы проекта.
//
// Выход наружу почти наверняка описка, а последствия у неё на чужой машине и
// необратимые: отправить домашний каталог на сервер можно ровно один раз.
func insideProject(p string) error {
	if p == "" {
		return fmt.Errorf("пустой путь")
	}
	if filepath.IsAbs(p) || strings.HasPrefix(p, "/") || strings.HasPrefix(p, `\`) {
		return fmt.Errorf("ожидался путь внутри проекта, а не абсолютный")
	}
	if len(p) > 1 && p[1] == ':' {
		return fmt.Errorf("ожидался путь внутри проекта, а не абсолютный")
	}
	for _, part := range strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." {
			return fmt.Errorf("ожидался путь внутри проекта")
		}
	}
	return nil
}
