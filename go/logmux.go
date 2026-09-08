package p3k

import (
	"bufio"
	"io"
	"strings"
	"sync"
)

// Мы держим не весь вывод, а хвост: дев-сервер за день напечатает больше,
// чем стоит хранить в памяти, а условие готовности срабатывает в первые
// секунды. Мегабайта хватает и на то, и на разбор падения.
const tailLimit = 1 << 20

// tail — хвост вывода одного процесса, безопасный для чтения из другой горутины.
type tail struct {
	mu   sync.Mutex
	data []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.data = append(t.data, p...)
	if len(t.data) > tailLimit {
		t.data = append([]byte(nil), t.data[len(t.data)-tailLimit:]...)
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.data)
}

// mux сводит вывод всех процессов в один поток, помечая каждую строку именем.
//
// Пишем только законченные строки: куски, пришедшие без перевода строки,
// копятся в буфере. Иначе вывод параллельных процессов перемешался бы посреди
// слова, и читать его стало бы нельзя.
type mux struct {
	mu    sync.Mutex
	out   io.Writer
	width int
}

func newMux(out io.Writer, names []string) *mux {
	width := 6
	for _, n := range names {
		if len(n) > width {
			width = len(n)
		}
	}
	return &mux{out: out, width: width}
}

func (m *mux) line(name, text string) {
	if m.out == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	io.WriteString(m.out, pad(name, m.width)+" │ "+text+"\n")
}

// system — сообщение самого окружения, а не процесса. Отбивается пустым полем
// имени, чтобы отличаться от чужого вывода.
func (m *mux) system(text string) { m.line("", text) }

func pad(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return s + strings.Repeat(" ", width-len(s))
}

// pump читает поток процесса построчно, отдавая строки в общий вывод и в хвост.
func (m *mux) pump(name string, r io.Reader, t *tail) {
	scanner := bufio.NewScanner(r)
	// Строки в логах бывают длинными — например, стек или строка сборки.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		text := scanner.Text()
		t.Write([]byte(text + "\n"))
		m.line(name, text)
	}
}
