package p3k

import "fmt"

// Ресурсы — куски окружения, которые проект добавляет к себе: база, кэш,
// хранилище файлов, ловушка для почты, край с прокси.
//
// Ресурс описан один раз и знает про оба окружения сразу: Process даёт запись
// для локальной разработки, Prod — продакшен-форму для выкатки. Смысл в том,
// что прод перестаёт отличаться от локалки не потому, что мы аккуратно
// переписали конфиг дважды, а потому что источник один.
//
// Значения здесь намеренно небезопасные — пароль dev, ключи minioadmin. Это
// контейнеры, которые живут полчаса на localhost; секреты продакшена приходят
// из другого места и в конфиг проекта не попадают.

// ResourcePort — порт, который ресурс занимает или к которому ходит.
type ResourcePort struct {
	ID   string
	Port int
	// What — что за порт: попадает в подсказки и в сообщение о занятости.
	What string
	// Bind — ресурс сам занимает этот порт. false означает, что порт чужой и
	// ресурс только ходит по нему: апстримы прокси заняты приложением, и это
	// норма, а не конфликт.
	Bind bool
}

// ResourceOpts — во что разворачивается ресурс в конкретном проекте.
type ResourceOpts struct {
	// Name — имя процесса в конфиге.
	Name string
	// Container — имя контейнера: <проект>-<имя процесса>.
	Container string
	// Project — имя проекта: попадает в имя базы и корзины.
	Project string
	// Ports — итоговые номера портов.
	Ports map[string]int
}

func (o ResourceOpts) port(id string) int {
	p, ok := o.Ports[id]
	if !ok {
		panic(fmt.Sprintf("ресурс не получил порт %q", id))
	}
	return p
}

// ProdForm — продакшен-форма ресурса.
//
// Та же служба, но с поправками, которые на localhost не нужны, а на сервере
// обязательны: перезапуск после падения, порт только на петле, пароль не из
// конфига, а из файла на сервере.
type ProdForm struct {
	// Service — запись службы в compose-файле.
	Service map[string]any
	// Volumes — именованные тома, которые нужно объявить в compose.
	Volumes []string
	// Env — что приложение должно получить из shared/.env на сервере.
	// Значения с угловыми скобками — заготовки: их заполняет человек.
	Env map[string]string
	// Files — файлы в shared/ рядом с compose.
	Files map[string]string
}

// ResourceDef — описание ресурса в каталоге.
type ResourceDef struct {
	ID      string
	Title   string
	Summary string
	// Requires — что должно быть на машине, чтобы это заработало.
	Requires string
	Ports    []ResourcePort
	// Process — запись для локальной разработки.
	Process func(ResourceOpts) Process
	// Env — переменные, которые ресурс даёт приложению локально.
	Env func(ResourceOpts) map[string]string
	// Files — файлы рядом с конфигом, без которых ресурс не поднимется.
	Files func(ResourceOpts) map[string]string
	// Prod — форма для сервера, или nil, если ресурсу там делать нечего:
	// ловушка для писем в проде означала бы, что почта никуда не уходит.
	Prod func(ResourceOpts) ProdForm
	// Notes — что стоит знать до первого запуска.
	Notes []string
}

// DefaultPorts — номера портов ресурса по умолчанию.
func (r ResourceDef) DefaultPorts() map[string]int {
	ports := make(map[string]int, len(r.Ports))
	for _, p := range r.Ports {
		ports[p.ID] = p.Port
	}
	return ports
}

// Resources — каталог известных ресурсов.
func Resources() []ResourceDef { return catalog }

// FindResource ищет ресурс по имени.
func FindResource(id string) (ResourceDef, bool) {
	for _, r := range catalog {
		if r.ID == id {
			return r, true
		}
	}
	return ResourceDef{}, false
}

// volume — том для данных.
//
// Контейнер запускается с --rm и исчезает после остановки, а том остаётся:
// иначе база пересоздавалась бы при каждом запуске, и наполнить её для отладки
// было бы нечем.
func volume(o ResourceOpts, path string) string {
	return fmt.Sprintf("-v %s-data:%s ", o.Container, path)
}

// loopback — проброс порта только на петлю: база должна быть видна с самого
// сервера, а не из интернета.
func loopback(o ResourceOpts, id string, inner int) []any {
	return []any{fmt.Sprintf("127.0.0.1:%d:%d", o.port(id), inner)}
}

// service — общая часть продакшен-службы. Перезапуск обязателен: прод,
// держащийся на удаче, — не прод.
func service(extra map[string]any) map[string]any {
	out := map[string]any{"restart": "unless-stopped"}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func healthcheck(test string) map[string]any {
	return map[string]any{
		"test":     []any{"CMD-SHELL", test},
		"interval": "5s",
		"timeout":  "3s",
		"retries":  20,
	}
}

func nginxConf(web, api int) string {
	return fmt.Sprintf(`# Локальный край: один адрес на фронтенд и API, как будет в проде.
# Приложения остаются на хосте, поэтому обращаемся к host.docker.internal —
# на Linux этот адрес появляется благодаря --add-host в команде запуска.

server {
  listen 80;
  server_name _;

  # Пустой ответ для проверки готовности: без него ready ловил бы 502, пока
  # приложение ещё не поднялось, и считал бы сломанным сам прокси.
  location = /healthz {
    add_header Content-Type text/plain;
    return 200 "ok\n";
  }

  location /api/ {
    proxy_pass http://host.docker.internal:%d/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://host.docker.internal:%d;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Вебсокеты нужны любому дев-серверу: без них не работает горячая замена.
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
`, api, web)
}

var catalog = []ResourceDef{
	{
		ID:       "postgres",
		Title:    "PostgreSQL 16",
		Summary:  "база в контейнере, данные переживают перезапуск",
		Requires: "Docker",
		Ports:    []ResourcePort{{ID: "port", Port: 5432, What: "подключение к базе", Bind: true}},
		Process: func(o ResourceOpts) Process {
			return Process{
				Name: o.Name,
				Command: fmt.Sprintf("docker run --rm --name %s -p %d:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=%s %spostgres:16",
					o.Container, o.port("port"), o.Project, volume(o, "/var/lib/postgresql/data")),
				// Порт открывается ещё во время инициализации кластера, поэтому
				// Port(5432) пропустил бы миграции вперёд самой базы.
				Ready: Exec(fmt.Sprintf("docker exec %s pg_isready -U postgres", o.Container)),
				Stop:  fmt.Sprintf("docker stop %s", o.Container),
			}
		},
		Env: func(o ResourceOpts) map[string]string {
			return map[string]string{
				"DATABASE_URL": fmt.Sprintf("postgres://postgres:dev@localhost:%d/%s", o.port("port"), o.Project),
			}
		},
		Prod: func(o ResourceOpts) ProdForm {
			return ProdForm{
				Service: service(map[string]any{
					"image": "postgres:16",
					"environment": map[string]any{
						"POSTGRES_PASSWORD": "${POSTGRES_PASSWORD:?нет в shared/.env}",
						"POSTGRES_DB":       o.Project,
					},
					"volumes":     []any{o.Name + "-data:/var/lib/postgresql/data"},
					"ports":       loopback(o, "port", 5432),
					"healthcheck": healthcheck("pg_isready -U postgres"),
				}),
				Volumes: []string{o.Name + "-data"},
				Env: map[string]string{
					"POSTGRES_PASSWORD": "<придумайте длинный пароль>",
					"DATABASE_URL":      fmt.Sprintf("postgres://postgres:<тот же пароль>@localhost:%d/%s", o.port("port"), o.Project),
				},
			}
		},
		Notes: []string{
			"Данные лежат в томе и переживают перезапуск. Начать с чистой базы: docker volume rm <контейнер>-data",
		},
	},

	{
		ID:       "mysql",
		Title:    "MySQL 8",
		Summary:  "база в контейнере, данные переживают перезапуск",
		Requires: "Docker",
		Ports:    []ResourcePort{{ID: "port", Port: 3306, What: "подключение к базе", Bind: true}},
		Process: func(o ResourceOpts) Process {
			return Process{
				Name: o.Name,
				Command: fmt.Sprintf("docker run --rm --name %s -p %d:3306 -e MYSQL_ROOT_PASSWORD=dev -e MYSQL_DATABASE=%s %smysql:8",
					o.Container, o.port("port"), o.Project, volume(o, "/var/lib/mysql")),
				Ready: Exec(fmt.Sprintf("docker exec %s mysqladmin ping -h 127.0.0.1 -uroot -pdev --silent", o.Container)),
				Stop:  fmt.Sprintf("docker stop %s", o.Container),
			}
		},
		Env: func(o ResourceOpts) map[string]string {
			return map[string]string{
				"DATABASE_URL": fmt.Sprintf("mysql://root:dev@localhost:%d/%s", o.port("port"), o.Project),
			}
		},
		Prod: func(o ResourceOpts) ProdForm {
			return ProdForm{
				Service: service(map[string]any{
					"image": "mysql:8",
					"environment": map[string]any{
						"MYSQL_ROOT_PASSWORD": "${MYSQL_ROOT_PASSWORD:?нет в shared/.env}",
						"MYSQL_DATABASE":      o.Project,
					},
					"volumes":     []any{o.Name + "-data:/var/lib/mysql"},
					"ports":       loopback(o, "port", 3306),
					"healthcheck": healthcheck(`mysqladmin ping -h 127.0.0.1 -uroot -p"$$MYSQL_ROOT_PASSWORD" --silent`),
				}),
				Volumes: []string{o.Name + "-data"},
				Env: map[string]string{
					"MYSQL_ROOT_PASSWORD": "<придумайте длинный пароль>",
					"DATABASE_URL":        fmt.Sprintf("mysql://root:<тот же пароль>@localhost:%d/%s", o.port("port"), o.Project),
				},
			}
		},
		Notes: []string{
			"Первый запуск дольше остальных: MySQL создаёт системные таблицы. Проверка готовности ждёт столько, сколько нужно.",
		},
	},

	{
		ID:       "redis",
		Title:    "Redis 7",
		Summary:  "кэш и очереди, локально без тома — содержимое одноразовое",
		Requires: "Docker",
		Ports:    []ResourcePort{{ID: "port", Port: 6379, What: "подключение к кэшу", Bind: true}},
		Process: func(o ResourceOpts) Process {
			return Process{
				Name:    o.Name,
				Command: fmt.Sprintf("docker run --rm --name %s -p %d:6379 redis:7", o.Container, o.port("port")),
				Ready:   Exec(fmt.Sprintf("docker exec %s redis-cli ping", o.Container)),
				Stop:    fmt.Sprintf("docker stop %s", o.Container),
			}
		},
		Env: func(o ResourceOpts) map[string]string {
			return map[string]string{"REDIS_URL": fmt.Sprintf("redis://localhost:%d", o.port("port"))}
		},
		Prod: func(o ResourceOpts) ProdForm {
			return ProdForm{
				Service: service(map[string]any{
					"image": "redis:7",
					// В проде кэш переживает перезапуск: терять его на каждом
					// обновлении — добровольно устраивать всплеск нагрузки на базу.
					"command":     "redis-server --save 60 1",
					"volumes":     []any{o.Name + "-data:/data"},
					"ports":       loopback(o, "port", 6379),
					"healthcheck": healthcheck("redis-cli ping"),
				}),
				Volumes: []string{o.Name + "-data"},
				Env:     map[string]string{"REDIS_URL": fmt.Sprintf("redis://localhost:%d", o.port("port"))},
			}
		},
		Notes: []string{
			"Локально тома нет намеренно: кэш, переживающий перезапуск, прячет ошибки вида «работает только со вчерашними данными».",
		},
	},

	{
		ID:       "mailpit",
		Title:    "Mailpit",
		Summary:  "ловушка для писем: приложение шлёт почту, наружу она не уходит",
		Requires: "Docker",
		Ports: []ResourcePort{
			{ID: "smtp", Port: 1025, What: "SMTP для приложения", Bind: true},
			{ID: "web", Port: 8025, What: "веб-интерфейс с письмами", Bind: true},
		},
		Process: func(o ResourceOpts) Process {
			return Process{
				Name: o.Name,
				Command: fmt.Sprintf("docker run --rm --name %s -p %d:1025 -p %d:8025 axllent/mailpit",
					o.Container, o.port("smtp"), o.port("web")),
				Ready: HTTP{URL: fmt.Sprintf("http://localhost:%d/", o.port("web"))},
				Stop:  fmt.Sprintf("docker stop %s", o.Container),
			}
		},
		Env: func(o ResourceOpts) map[string]string {
			return map[string]string{
				"SMTP_HOST": "localhost",
				"SMTP_PORT": fmt.Sprint(o.port("smtp")),
				"SMTP_FROM": "dev@localhost",
			}
		},
		// В проде ловушка означала бы, что письма клиентам никуда не уходят.
		Prod: nil,
		Notes: []string{
			"Письма видны в браузере и никуда не отправляются — можно отлаживать рассылку на настоящих адресах.",
			"На сервер этот ресурс не поедет: там нужен настоящий отправитель почты.",
		},
	},

	{
		ID:       "minio",
		Title:    "MinIO",
		Summary:  "хранилище файлов с тем же API, что у S3",
		Requires: "Docker",
		Ports: []ResourcePort{
			{ID: "api", Port: 9000, What: "S3 API", Bind: true},
			{ID: "console", Port: 9001, What: "веб-консоль", Bind: true},
		},
		Process: func(o ResourceOpts) Process {
			return Process{
				Name: o.Name,
				Command: fmt.Sprintf(`docker run --rm --name %s -p %d:9000 -p %d:9001 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin %sminio/minio server /data --console-address ":9001"`,
					o.Container, o.port("api"), o.port("console"), volume(o, "/data")),
				Ready: HTTP{URL: fmt.Sprintf("http://localhost:%d/minio/health/live", o.port("api"))},
				Stop:  fmt.Sprintf("docker stop %s", o.Container),
			}
		},
		Env: func(o ResourceOpts) map[string]string {
			return map[string]string{
				"S3_ENDPOINT":         fmt.Sprintf("http://localhost:%d", o.port("api")),
				"S3_ACCESS_KEY":       "minioadmin",
				"S3_SECRET_KEY":       "minioadmin",
				"S3_BUCKET":           o.Project,
				"S3_FORCE_PATH_STYLE": "true",
			}
		},
		Prod: func(o ResourceOpts) ProdForm {
			ports := loopback(o, "api", 9000)
			ports = append(ports, loopback(o, "console", 9001)...)
			return ProdForm{
				Service: service(map[string]any{
					"image":   "minio/minio",
					"command": `server /data --console-address ":9001"`,
					"environment": map[string]any{
						"MINIO_ROOT_USER":     "${MINIO_ROOT_USER:?нет в shared/.env}",
						"MINIO_ROOT_PASSWORD": "${MINIO_ROOT_PASSWORD:?нет в shared/.env}",
					},
					"volumes":     []any{o.Name + "-data:/data"},
					"ports":       ports,
					"healthcheck": healthcheck("mc ready local || curl -f http://localhost:9000/minio/health/live"),
				}),
				Volumes: []string{o.Name + "-data"},
				Env: map[string]string{
					"MINIO_ROOT_USER":     "<имя учётной записи>",
					"MINIO_ROOT_PASSWORD": "<придумайте длинный пароль>",
					"S3_ENDPOINT":         fmt.Sprintf("http://localhost:%d", o.port("api")),
					"S3_ACCESS_KEY":       "<то же имя>",
					"S3_SECRET_KEY":       "<тот же пароль>",
					"S3_BUCKET":           o.Project,
					"S3_FORCE_PATH_STYLE": "true",
				},
			}
		},
		Notes: []string{
			"Корзину создайте сами — MinIO не делает этого за вас. Консоль на порту 9001, вход minioadmin / minioadmin.",
			"S3_FORCE_PATH_STYLE обязателен: MinIO не понимает адреса вида bucket.host.",
		},
	},

	{
		ID:       "nginx",
		Title:    "nginx",
		Summary:  "один адрес на фронтенд и API — как будет в проде",
		Requires: "Docker",
		Ports: []ResourcePort{
			{ID: "port", Port: 8080, What: "общий вход", Bind: true},
			{ID: "web", Port: 3000, What: "фронтенд на хосте", Bind: false},
			{ID: "api", Port: 4000, What: "API на хосте", Bind: false},
		},
		Process: func(o ResourceOpts) Process {
			return Process{
				Name: o.Name,
				Command: fmt.Sprintf("docker run --rm --name %s -p %d:80 --add-host=host.docker.internal:host-gateway -v ./nginx.dev.conf:/etc/nginx/conf.d/default.conf:ro nginx:1.27-alpine",
					o.Container, o.port("port")),
				Ready: HTTP{URL: fmt.Sprintf("http://localhost:%d/healthz", o.port("port"))},
				Stop:  fmt.Sprintf("docker stop %s", o.Container),
			}
		},
		Env: func(o ResourceOpts) map[string]string {
			return map[string]string{"PUBLIC_URL": fmt.Sprintf("http://localhost:%d", o.port("port"))}
		},
		Files: func(o ResourceOpts) map[string]string {
			return map[string]string{"nginx.dev.conf": nginxConf(o.port("web"), o.port("api"))}
		},
		Prod: func(o ResourceOpts) ProdForm {
			return ProdForm{
				Service: service(map[string]any{
					"image": "nginx:1.27-alpine",
					// Приложение живёт на самом сервере, а не в compose, поэтому
					// прокси нужен путь к хосту: на Linux его даёт host-gateway.
					"extra_hosts": []any{"host.docker.internal:host-gateway"},
					"volumes":     []any{"./nginx.conf:/etc/nginx/conf.d/default.conf:ro"},
					"ports":       []any{"80:80"},
					"healthcheck": healthcheck("wget -q -O - http://localhost/healthz"),
				}),
				Env:   map[string]string{"PUBLIC_URL": "<https://ваш-домен>"},
				Files: map[string]string{"nginx.conf": nginxConf(o.port("web"), o.port("api"))},
			}
		},
		Notes: []string{
			"Правила лежат в nginx.dev.conf — это обычный конфиг nginx, правьте как есть.",
			"Относительный путь в -v требует Docker 23 или новее.",
			"TLS здесь нет: сертификаты выпускайте сами, например certbot.",
		},
	},
}
