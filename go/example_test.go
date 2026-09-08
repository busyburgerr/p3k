package p3k_test

import (
	"context"
	"fmt"
	"log"
	"os"
	"testing"
	"time"

	p3k "github.com/busyburgerr/p3k/go"
)

// Самый частый случай: интеграционным тестам нужны настоящие база и кэш.
//
// Start возвращается не тогда, когда контейнеры запущены, а когда база начала
// отвечать на запросы. Разница между этими двумя моментами — почти все
// плавающие падения интеграционных тестов.
func ExampleEnv_Start() {
	cfg, err := p3k.LoadDir(".")
	if err != nil {
		log.Fatal(err)
	}

	env := p3k.New(cfg, p3k.WithOnly("postgres", "redis"))

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	if err := env.Start(ctx); err != nil {
		log.Fatal(err)
	}
	defer env.Stop(context.Background())

	// Здесь окружение поднято и отвечает.
}

// Так это выглядит в TestMain: окружение поднимается один раз на весь пакет.
func ExampleNew_testMain() {
	var m *testing.M // в настоящем TestMain приходит аргументом

	cfg, err := p3k.LoadDir(".")
	if err != nil {
		log.Fatal(err)
	}

	// Вывод процессов показываем только при -v: иначе он забьёт отчёт теста.
	var out *os.File
	if testing.Verbose() {
		out = os.Stdout
	}
	env := p3k.New(cfg, p3k.WithOutput(out))

	ctx := context.Background()
	if err := env.Start(ctx); err != nil {
		log.Fatal(err)
	}
	code := m.Run()
	env.Stop(ctx)
	os.Exit(code)
}

// Своё условие готовности: когда готовность службы определяется по-своему.
//
// Здесь окружение считается поднятым, только когда в базе появилась таблица —
// то есть после того, как отработали миграции.
func ExampleWithReady() {
	cfg, err := p3k.LoadDir(".")
	if err != nil {
		log.Fatal(err)
	}

	migrated := p3k.Exec(`docker exec shop-postgres psql -U postgres -d shop -c "select 1 from пользователи limit 1"`)
	env := p3k.New(cfg, p3k.WithReady("postgres", migrated))

	if err := env.Start(context.Background()); err != nil {
		log.Fatal(err)
	}
	defer env.Stop(context.Background())
}

// Дев-сервер: поднять, дождаться беды, погасить.
func ExampleEnv_Wait() {
	cfg, err := p3k.LoadDir(".")
	if err != nil {
		log.Fatal(err)
	}
	env := p3k.New(cfg, p3k.WithOutput(os.Stdout))

	ctx := context.Background()
	if err := env.Start(ctx); err != nil {
		log.Fatal(err)
	}

	// Возвращается, когда завершился долгоживущий процесс: для окружения это
	// смерть, даже если код возврата нулевой.
	err = env.Wait(ctx)
	env.Stop(ctx)
	fmt.Println("окружение остановлено:", err)
}

// Выкатка на свой сервер.
//
// Новый выпуск заливается рядом с работающим; ссылка переключается, только
// когда всё готово. Не ответило — ссылка вернётся назад сама.
func ExampleShip() {
	cfg, err := p3k.LoadDir(".")
	if err != nil {
		log.Fatal(err)
	}

	report, err := p3k.Ship(context.Background(), cfg, p3k.WithShipOutput(os.Stdout))
	if err != nil {
		if report != nil && report.RolledBack {
			log.Fatalf("выкатка не удалась, откатились на %s: %v", report.Release, err)
		}
		log.Fatal(err)
	}
	fmt.Println("выкачено:", report.Release)
}

// Прогон проверок: независимые идут разом, зависимые ждут своих.
func ExampleRunChecks() {
	cfg, err := p3k.LoadDir(".")
	if err != nil {
		log.Fatal(err)
	}

	report, err := p3k.RunChecks(context.Background(), cfg, p3k.WithCheckOutput(os.Stdout))
	if err != nil {
		log.Fatal(err)
	}
	if !report.OK() {
		for _, failed := range report.Failed() {
			fmt.Printf("%s: %v\n%s\n", failed.Name, failed.Err, failed.Output)
		}
		os.Exit(1)
	}
}
