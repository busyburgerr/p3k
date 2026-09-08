// Пакет fslink делает ссылку на каталог, которую можно переключить.
//
// На ней держится вся выкатка: новый выпуск лежит рядом со старым, и включение
// нового — это одно движение ссылки. Поэтому откат стоит столько же, сколько
// выкатка, и не требует пересборки.
package fslink

// Make создаёт ссылку link, указывающую на каталог target.
func Make(target, link string) error { return makeLink(target, link) }

// Read возвращает, куда указывает ссылка.
func Read(link string) (string, error) { return readLink(link) }

// Remove снимает ссылку, не трогая то, на что она указывает.
func Remove(link string) error { return removeLink(link) }

// Exists сообщает, что ссылка на месте — даже если она никуда не ведёт.
//
// Обычная проверка существования идёт по ссылке и на повисшей отвечает «нет»,
// после чего переименование упало бы с «файл уже существует».
func Exists(link string) bool { return linkExists(link) }
