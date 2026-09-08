package p3k

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Check — проверка проекта: то, что должно пройти до того, как это прогонит CI.
type Check struct {
	Name string
	// Needs — проверки, которые должны пройти раньше этой: бюджет размера
	// не имеет смысла до сборки.
	Needs []string
	// Optional — падение не валит прогон целиком.
	Optional bool
	// Inputs — файлы и каталоги, от которых зависит результат. Пока они не
	// менялись, успешный результат берётся из кэша. Пустой список означает
	// «не кэшировать»: не зная входов, нельзя утверждать, что ничего не
	// изменилось.
	Inputs []string

	// Command — обычная проверка. Пусто, если это бюджет размера.
	Command string
	Dir     string

	// Size — бюджет размера собранного.
	Size *SizeGate
}

func (c Check) NodeName() string    { return c.Name }
func (c Check) NodeNeeds() []string { return c.Needs }

// SizeGate — сколько собранному позволено весить.
type SizeGate struct {
	// Path — файл или каталог, относительно корня проекта.
	Path string
	// Max — порог в байтах.
	Max int64
	// Gzip — мерить сжатым: столько же увидит браузер.
	Gzip bool
}

type rawCheck struct {
	Command  string          `json:"command"`
	Dir      string          `json:"cwd"`
	Needs    []string        `json:"needs"`
	Optional bool            `json:"optional"`
	Inputs   []string        `json:"inputs"`
	Size     json.RawMessage `json:"size"`
}

type rawSize struct {
	Path string `json:"path"`
	Max  any    `json:"max"`
	Gzip bool   `json:"gzip"`
}

func parseCheck(name string, data []byte, where string) (*Check, error) {
	var r rawCheck
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, errf(where, "ожидался объект — %v", err)
	}

	c := &Check{
		Name:     name,
		Needs:    r.Needs,
		Optional: r.Optional,
		Inputs:   r.Inputs,
		Dir:      r.Dir,
	}

	switch {
	case strings.TrimSpace(r.Command) != "":
		c.Command = r.Command
		return c, nil

	case len(r.Size) > 0:
		var s rawSize
		if err := json.Unmarshal(r.Size, &s); err != nil {
			return nil, errf(where+".size", "ожидался объект — %v", err)
		}
		if strings.TrimSpace(s.Path) == "" {
			return nil, errf(where+".size.path", "обязательная непустая строка")
		}
		if s.Max == nil {
			return nil, errf(where+".size.max", "обязательное поле, например \"180kb\"")
		}
		max, ok := ParseSize(s.Max)
		if !ok {
			return nil, errf(where+".size.max", "не разобрали %v — ожидалось что-то вроде \"180kb\"", s.Max)
		}
		c.Size = &SizeGate{Path: s.Path, Max: max, Gzip: s.Gzip}
		return c, nil
	}

	return nil, errf(where, "ожидалось одно из { command } | { size }")
}

var sizeRe = regexp.MustCompile(`^([0-9]+(?:[.,][0-9]+)?)\s*(b|kb|mb|gb|k|m|g)?$`)

var sizeUnits = map[string]int64{
	"":   1,
	"b":  1,
	"k":  1 << 10,
	"kb": 1 << 10,
	"m":  1 << 20,
	"mb": 1 << 20,
	"g":  1 << 30,
	"gb": 1 << 30,
}

// ParseSize разбирает запись бюджета: 180kb, "1.5 MB", 4096.
//
// Килобайт здесь — 1024 байта, как их считают инструменты сборки, а не тысяча,
// как их считают производители дисков.
//
// Возвращает false, если разобрать не удалось: молчаливый ноль превратил бы
// опечатку в бюджет, который невозможно уложиться.
func ParseSize(v any) (int64, bool) {
	switch t := v.(type) {
	case float64:
		if t < 0 || t != float64(int64(t)) {
			return 0, false
		}
		return int64(t), true
	case int:
		if t < 0 {
			return 0, false
		}
		return int64(t), true
	case string:
		m := sizeRe.FindStringSubmatch(strings.ToLower(strings.TrimSpace(t)))
		if m == nil {
			return 0, false
		}
		n, err := strconv.ParseFloat(strings.Replace(m[1], ",", ".", 1), 64)
		if err != nil {
			return 0, false
		}
		return int64(n * float64(sizeUnits[m[2]])), true
	}
	return 0, false
}

// FormatSize печатает размер так, как его читают люди.
func FormatSize(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1fmb", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1fkb", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%db", n)
	}
}
