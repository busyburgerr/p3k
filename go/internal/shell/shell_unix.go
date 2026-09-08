//go:build !windows

package shell

import "os/exec"

// finalize на Unix не нужен: аргументы уходят ядру массивом, и оболочка
// получает команду ровно такой, какой мы её написали.
func finalize(*exec.Cmd, string) {}
