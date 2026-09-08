package p3k

import (
	"fmt"
	"sort"
	"strings"
)

// ComposePlan — продакшен-половина ресурсов проекта.
//
// Локально ресурсы — это команды docker run в конфиге; на сервере — службы в
// одном compose-файле. Описание при этом одно: и то и другое собирается из
// секции resources. Поэтому база в проде — та же база, что на ноутбуке, а не
// её пересказ по памяти.
type ComposePlan struct {
	YAML string
	// Files — что едет в shared/ рядом с compose.
	Files map[string]string
	// Env — что должно оказаться в shared/.env на сервере.
	Env map[string]string
	// Skipped — ресурсы, которым в проде не место: mailpit и подобные.
	Skipped []string
	// Services — имена служб в compose.
	Services []string
}

// Compose собирает продакшен-манифест из реестра ресурсов проекта.
//
// Возвращает nil, если поднимать на сервере нечего: ресурсов нет вовсе или все
// они только для разработки. Ресурсы, которых нет в каталоге, пропускаются
// молча — конфиг мог быть написан более новой версией, и падать из-за этого
// нельзя.
func Compose(resources map[string]ResourceRef, project string) *ComposePlan {
	services := map[string]any{}
	volumes := map[string]any{}
	plan := &ComposePlan{Files: map[string]string{}, Env: map[string]string{}}

	names := make([]string, 0, len(resources))
	for name := range resources {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		ref := resources[name]
		def, ok := FindResource(ref.Type)
		if !ok {
			continue
		}
		if def.Prod == nil {
			plan.Skipped = append(plan.Skipped, fmt.Sprintf("%s (%s)", name, def.Title))
			continue
		}

		ports := def.DefaultPorts()
		for id, p := range ref.Ports {
			ports[id] = p
		}

		form := def.Prod(ResourceOpts{
			Name:      name,
			Container: project + "-" + name,
			Project:   project,
			Ports:     ports,
		})

		services[name] = form.Service
		plan.Services = append(plan.Services, name)
		for _, v := range form.Volumes {
			volumes[v] = nil
		}
		for k, v := range form.Env {
			plan.Env[k] = v
		}
		for k, v := range form.Files {
			plan.Files[k] = v
		}
	}

	if len(services) == 0 {
		return nil
	}

	doc := map[string]any{"services": services}
	if len(volumes) > 0 {
		doc["volumes"] = volumes
	}

	plan.YAML = "# Собрано библиотекой p3k из секции resources в p3k.json.\n" +
		"# Правки здесь потеряются при следующей выкатке — правьте конфиг проекта.\n" +
		"# Пароли берутся из shared/.env рядом с этим файлом и сюда не попадают.\n" +
		strings.TrimPrefix(toYAML(doc, 0), "\n")

	return plan
}

// EnvExample — заготовка shared/.env: значения в угловых скобках человек
// заполняет сам.
func (p *ComposePlan) EnvExample() string {
	lines := []string{
		"# Переменные окружения продакшена. Файл остаётся на сервере и никуда",
		"# не отправляется. Значения в угловых скобках замените своими.",
		"",
	}
	keys := make([]string, 0, len(p.Env))
	for k := range p.Env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		lines = append(lines, k+"="+p.Env[k])
	}
	return strings.Join(lines, "\n") + "\n"
}

// Unfilled — переменные, которые человек ещё не заполнил.
func (p *ComposePlan) Unfilled() []string {
	var out []string
	for k, v := range p.Env {
		if strings.Contains(v, "<") {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// toYAML печатает нашу же структуру.
//
// Полноценная библиотека здесь не нужна: мы выводим то, что сами построили, а
// не разбираем чужое. Строки всегда в двойных кавычках — так не нужно гадать,
// какие из них YAML примет за число, дату или значение вроде no.
func toYAML(v any, indent int) string {
	pad := strings.Repeat("  ", indent)

	switch t := v.(type) {
	case nil:
		return " null\n"

	case map[string]any:
		if len(t) == 0 {
			return " {}\n"
		}
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		var b strings.Builder
		b.WriteString("\n")
		for _, k := range keys {
			b.WriteString(pad + k + ":" + toYAML(t[k], indent+1))
		}
		return b.String()

	case []any:
		if len(t) == 0 {
			return " []\n"
		}
		var b strings.Builder
		b.WriteString("\n")
		for _, item := range t {
			b.WriteString(pad + "- " + strings.TrimLeft(toYAML(item, indent+1), " "))
		}
		return b.String()

	case string:
		return " \"" + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(t) + "\"\n"

	default:
		return fmt.Sprintf(" %v\n", t)
	}
}
