package p3k_test

import (
	"errors"
	"strings"
	"testing"

	p3k "github.com/busyburgerr/p3k/go"
)

// node — простейший узел графа: имя и зависимости, больше волнам ничего не надо.
type node struct {
	name  string
	needs []string
}

func (n node) NodeName() string    { return n.name }
func (n node) NodeNeeds() []string { return n.needs }

func shape(waves [][]node) []string {
	out := make([]string, 0, len(waves))
	for _, wave := range waves {
		names := make([]string, 0, len(wave))
		for _, n := range wave {
			names = append(names, n.name)
		}
		out = append(out, strings.Join(names, "+"))
	}
	return out
}

func TestWavesGroupIndependentWork(t *testing.T) {
	cases := []struct {
		name  string
		nodes []node
		want  []string
	}{
		{
			name:  "независимые идут разом",
			nodes: []node{{name: "db"}, {name: "cache"}, {name: "queue"}},
			want:  []string{"db+cache+queue"},
		},
		{
			name:  "цепочка разворачивается по одной",
			nodes: []node{{name: "a"}, {name: "b", needs: []string{"a"}}, {name: "c", needs: []string{"b"}}},
			want:  []string{"a", "b", "c"},
		},
		{
			// Ромб: середина параллельна, схождение ждёт обе стороны.
			name: "ромб",
			nodes: []node{
				{name: "db"},
				{name: "миграции", needs: []string{"db"}},
				{name: "сиды", needs: []string{"db"}},
				{name: "api", needs: []string{"миграции", "сиды"}},
			},
			want: []string{"db", "миграции+сиды", "api"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			waves, err := p3k.Waves(c.nodes)
			if err != nil {
				t.Fatal(err)
			}
			got := shape(waves)
			if strings.Join(got, " → ") != strings.Join(c.want, " → ") {
				t.Errorf("волны разложились как %v, ожидали %v", got, c.want)
			}
		})
	}
}

func TestWavesReportCycleParticipants(t *testing.T) {
	nodes := []node{
		{name: "a", needs: []string{"b"}},
		{name: "b", needs: []string{"a"}},
		{name: "сам по себе"},
	}

	_, err := p3k.Waves(nodes)
	var cycle *p3k.CycleError
	if !errors.As(err, &cycle) {
		t.Fatalf("кольцо не распознано: %v", err)
	}
	if len(cycle.Stuck) != 2 || cycle.Stuck[0] != "a" || cycle.Stuck[1] != "b" {
		t.Errorf("названы не те участники: %v", cycle.Stuck)
	}
	// Независимый узел не должен попасть в список: он-то ни при чём.
	for _, name := range cycle.Stuck {
		if name == "сам по себе" {
			t.Error("в кольцо записали непричастного")
		}
	}
}

func TestUnknownNeedsSeparateFromCycles(t *testing.T) {
	// Опечатка и кольцо — разные беды, и объяснять их надо по-разному.
	bad := p3k.UnknownNeeds([]node{{name: "api", needs: []string{"баз"}}})
	if len(bad) != 1 || !strings.Contains(bad[0], "баз") {
		t.Errorf("неизвестная зависимость не найдена: %v", bad)
	}
	if len(p3k.UnknownNeeds([]node{{name: "a"}, {name: "b", needs: []string{"a"}}})) != 0 {
		t.Error("нашли неизвестное там, где всё известно")
	}
}

func TestWithNeedsPullsInDependencies(t *testing.T) {
	nodes := []node{
		{name: "db"},
		{name: "cache"},
		{name: "api", needs: []string{"db"}},
		{name: "web", needs: []string{"api"}},
	}

	got := shape([][]node{p3k.WithNeeds(nodes, []string{"web"})})
	if got[0] != "db+api+web" {
		t.Errorf("замыкание по зависимостям неполное: %v", got)
	}

	if len(p3k.WithNeeds(nodes, []string{"нет такого"})) != 0 {
		t.Error("несуществующее имя не должно ничего тащить")
	}
}

func TestReverseTurnsStartupIntoShutdown(t *testing.T) {
	waves := [][]node{{{name: "db"}}, {{name: "api"}}, {{name: "web"}}}
	got := shape(p3k.Reverse(waves))
	if got[0] != "web" || got[2] != "db" {
		t.Errorf("гасить надо в обратном порядке, получили %v", got)
	}
}

func TestParseSizeUnderstandsHumanUnits(t *testing.T) {
	cases := map[any]int64{
		"180kb":       180 * 1024,
		"1.5 MB":      1024*1024 + 512*1024,
		"2k":          2048,
		"4096":        4096,
		float64(4096): 4096,
	}
	for in, want := range cases {
		got, ok := p3k.ParseSize(in)
		if !ok || got != want {
			t.Errorf("%v → %d, %v; ожидали %d", in, got, ok, want)
		}
	}

	// Молчаливый ноль превратил бы опечатку в невыполнимый бюджет.
	for _, in := range []any{"много", "", "kb", -1, "-5kb"} {
		if _, ok := p3k.ParseSize(in); ok {
			t.Errorf("%v разобралось, хотя не должно", in)
		}
	}
}
