package p3k

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/busyburgerr/p3k/go/internal/shell"
)

// Как часто переспрашивать условие готовности.
//
// Пятая доля секунды — компромисс: чаще значит греть процессор и мешать
// службе подниматься, реже — терять на каждом процессе заметное время.
const pollInterval = 200 * time.Millisecond

// Probe — то, что условие готовности знает о процессе.
//
// Через него условия добираются до вывода и до состояния процесса, не завися
// от того, как устроено окружение.
type Probe interface {
	// Dir — рабочий каталог процесса.
	Dir() string
	// Environ — окружение процесса в виде "КЛЮЧ=значение".
	Environ() []string
	// Output — всё, что процесс напечатал к этому моменту.
	Output() string
	// Exited сообщает, что процесс уже завершился, и с каким исходом.
	Exited() (bool, error)
}

// Ready — условие, после которого процесс считается готовым.
//
// Реализовать его может кто угодно: если готовность вашей службы определяется
// как-то по-своему, передайте собственное условие через WithReady.
type Ready interface {
	// Wait возвращает nil, когда условие выполнено. Прерывается по контексту.
	Wait(ctx context.Context, p Probe) error
	// String описывает условие человеку — оно попадает в лог и в ошибки.
	String() string
}

// ErrExited означает, что процесс завершился, не дождавшись готовности.
var ErrExited = errors.New("процесс завершился, не став готовым")

// poll переспрашивает условие, пока оно не выполнится.
//
// Заодно следит за самим процессом: если он умер, ждать больше нечего и незачем
// держать вызывающего до истечения срока — это самая частая причина того, что
// «тест висит десять минут и падает по таймауту».
func poll(ctx context.Context, p Probe, check func() (bool, error)) error {
	for {
		ok, err := check()
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
		if done, err := p.Exited(); done {
			if err != nil {
				return fmt.Errorf("%w: %v", ErrExited, err)
			}
			return ErrExited
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}

// Port — сокет принимает соединение.
//
// Дёшево и почти всегда достаточно, но врёт на службах, которые открывают порт
// раньше, чем готовы обслуживать: Postgres принимает соединения ещё во время
// инициализации кластера. Для таких берите Exec.
type Port int

func (r Port) String() string { return "порт " + strconv.Itoa(int(r)) }

func (r Port) Wait(ctx context.Context, p Probe) error {
	return poll(ctx, p, func() (bool, error) {
		// Обе петли: служба могла привязаться только к IPv6, и проверка по
		// 127.0.0.1 объявила бы её неготовой навсегда.
		for _, host := range []string{"127.0.0.1", "[::1]"} {
			conn, err := net.DialTimeout("tcp", host+":"+strconv.Itoa(int(r)), time.Second)
			if err == nil {
				conn.Close()
				return true, nil
			}
		}
		return false, nil
	})
}

// HTTP — ответ по адресу.
//
// Проверяет, что служба отвечает по делу, а не просто слушает. Status нулевой
// означает «любой ниже 500»: 404 на корне — это работающий сервер.
type HTTP struct {
	URL    string
	Status int
}

func (r HTTP) String() string {
	if r.Status == 0 {
		return "ответ " + r.URL
	}
	return fmt.Sprintf("%s → %d", r.URL, r.Status)
}

func (r HTTP) Wait(ctx context.Context, p Probe) error {
	client := &http.Client{
		Timeout: 5 * time.Second,
		// Переадресацию не проходим: 302 от живого сервера — это уже ответ,
		// а ходить за ней значит проверять чужой адрес вместо своего.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}

	return poll(ctx, p, func() (bool, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.URL, nil)
		if err != nil {
			return false, fmt.Errorf("негодный адрес %q: %w", r.URL, err)
		}
		res, err := client.Do(req)
		if err != nil {
			return false, nil
		}
		res.Body.Close()

		if r.Status != 0 {
			return res.StatusCode == r.Status, nil
		}
		return res.StatusCode < 500, nil
	})
}

// Exec — команда завершилась успешно.
//
// Единственный честный способ для баз: `docker exec app-db pg_isready -U postgres`
// спрашивает саму службу, а не гадает по открытому порту.
type Exec string

func (r Exec) String() string { return "успех " + strconv.Quote(string(r)) }

func (r Exec) Wait(ctx context.Context, p Probe) error {
	return poll(ctx, p, func() (bool, error) {
		return shell.Succeeds(ctx, string(r), p.Dir(), p.Environ()), nil
	})
}

// Log — строка появилась в выводе.
//
// Для того, что не слушает порт: сборщиков, воркеров, генераторов.
type Log string

func (r Log) String() string { return "строка " + strconv.Quote(string(r)) + " в выводе" }

func (r Log) Wait(ctx context.Context, p Probe) error {
	return poll(ctx, p, func() (bool, error) {
		return strings.Contains(p.Output(), string(r)), nil
	})
}

// Delay — просто подождать.
//
// Признание поражения; оставлено потому, что иногда другого способа правда нет.
type Delay time.Duration

func (r Delay) String() string { return "пауза " + time.Duration(r).String() }

func (r Delay) Wait(ctx context.Context, p Probe) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Duration(r)):
		return nil
	}
}

// Immediate — готов сразу после запуска. Подразумевается, когда условие не задано.
type Immediate struct{}

func (Immediate) String() string { return "сразу после запуска" }

func (Immediate) Wait(context.Context, Probe) error { return nil }

// Succeeded — процесс отработал и вышел с нулём.
//
// Подразумевается для разовых шагов: у миграции нет ни порта, ни адреса, и
// готовность для неё — это успешное завершение.
type Succeeded struct{}

func (Succeeded) String() string { return "успешное завершение" }

// Wait не пользуется общим опросом намеренно: там завершение процесса — повод
// прекратить ожидание, а здесь оно и есть искомое событие.
func (Succeeded) Wait(ctx context.Context, p Probe) error {
	for {
		if done, err := p.Exited(); done {
			if err != nil {
				return fmt.Errorf("шаг завершился неудачно: %w", err)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}
