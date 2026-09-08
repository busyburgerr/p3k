//go:build !windows

package fslink

import "os"

func makeLink(target, link string) error { return os.Symlink(target, link) }

func readLink(link string) (string, error) { return os.Readlink(link) }

func removeLink(link string) error { return os.Remove(link) }

func linkExists(link string) bool {
	_, err := os.Lstat(link)
	return err == nil
}
