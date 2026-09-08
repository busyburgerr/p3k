package p3k

import (
	"fmt"
	"sort"
	"strings"
)

// Node — узел графа зависимостей. Ему всё равно, процесс это или проверка.
type Node interface {
	NodeName() string
	NodeNeeds() []string
}

func (p Process) NodeName() string    { return p.Name }
func (p Process) NodeNeeds() []string { return p.Needs }

// CycleError — в графе кольцо: каждый ждёт другого, и начать некому.
type CycleError struct {
	// Stuck — узлы, до которых очередь так и не дошла.
	Stuck []string
}

func (e *CycleError) Error() string {
	return "кольцевая зависимость между: " + strings.Join(e.Stuck, ", ")
}

// Waves раскладывает узлы по волнам.
//
// В одной волне — те, чьи зависимости уже удовлетворены предыдущими волнами.
// Внутри волны порядок не важен: их можно запускать разом, и в этом весь смысл
// — независимое не должно ждать друг друга.
//
// Волны, а не обычная топологическая сортировка, потому что нам нужен не
// порядок, а именно группы: сортировка выстроила бы базу и кэш в очередь, хотя
// они друг друга не касаются.
func Waves[T Node](nodes []T) ([][]T, error) {
	done := make(map[string]bool, len(nodes))
	left := make([]T, len(nodes))
	copy(left, nodes)

	var waves [][]T
	for len(left) > 0 {
		var wave, rest []T
		for _, n := range left {
			if ready(n, done) {
				wave = append(wave, n)
			} else {
				rest = append(rest, n)
			}
		}

		if len(wave) == 0 {
			stuck := make([]string, 0, len(rest))
			for _, n := range rest {
				stuck = append(stuck, n.NodeName())
			}
			sort.Strings(stuck)
			return nil, &CycleError{Stuck: stuck}
		}

		for _, n := range wave {
			done[n.NodeName()] = true
		}
		waves = append(waves, wave)
		left = rest
	}
	return waves, nil
}

func ready[T Node](n T, done map[string]bool) bool {
	for _, need := range n.NodeNeeds() {
		if !done[need] {
			return false
		}
	}
	return true
}

// UnknownNeeds находит ссылки на узлы, которых нет.
//
// Отдельно от Waves потому, что это разные беды: опечатка в имени и кольцо
// требуют разных объяснений, а свалить их в одну ошибку — значит заставить
// человека гадать.
func UnknownNeeds[T Node](nodes []T) []string {
	known := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		known[n.NodeName()] = true
	}

	var bad []string
	for _, n := range nodes {
		for _, need := range n.NodeNeeds() {
			if !known[need] {
				bad = append(bad, fmt.Sprintf("%s → %s", n.NodeName(), need))
			}
		}
	}
	sort.Strings(bad)
	return bad
}

// Reverse переворачивает волны: так гасят то, что подняли.
//
// Приложение должно уйти раньше базы, иначе последним, что оно запишет в лог,
// будет ошибка подключения.
func Reverse[T any](waves [][]T) [][]T {
	out := make([][]T, len(waves))
	for i := range waves {
		out[i] = waves[len(waves)-1-i]
	}
	return out
}

// WithNeeds дополняет выбор именами, от которых выбранное зависит.
//
// Поднять «только приложение» нельзя: без базы оно не поднимется. Поэтому
// выбор всегда расширяется до замыкания по зависимостям.
func WithNeeds[T Node](nodes []T, names []string) []T {
	byName := make(map[string]T, len(nodes))
	for _, n := range nodes {
		byName[n.NodeName()] = n
	}

	want := map[string]bool{}
	var add func(string)
	add = func(name string) {
		if want[name] {
			return
		}
		n, ok := byName[name]
		if !ok {
			return
		}
		want[name] = true
		for _, need := range n.NodeNeeds() {
			add(need)
		}
	}
	for _, name := range names {
		add(name)
	}

	// Порядок исходного списка сохраняем: он предсказуем для человека.
	var out []T
	for _, n := range nodes {
		if want[n.NodeName()] {
			out = append(out, n)
		}
	}
	return out
}
