package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	if len(os.Args) != 3 {
		panic("package-release <package dir> <output zip>")
	}
	root, err := filepath.Abs(os.Args[1])
	if err != nil {
		panic(err)
	}
	var files []string
	err = filepath.Walk(root, func(p string, info os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		if info.IsDir() {
			return nil
		}
		rel, e := filepath.Rel(root, p)
		if e != nil {
			return e
		}
		rel = filepath.ToSlash(rel)
		// The updater is stable and is not replaced by ordinary releases.
		if rel == "Uninstall.exe" || strings.HasPrefix(rel, "tests/") {
			return nil
		}
		if info.Mode()&os.ModeType != 0 {
			return fmt.Errorf("non-regular source: %s", rel)
		}
		files = append(files, p)
		return nil
	})
	if err != nil {
		panic(err)
	}
	sort.Strings(files)
	out, err := os.Create(os.Args[2])
	if err != nil {
		panic(err)
	}
	z := zip.NewWriter(out)
	for _, file := range files {
		rel, _ := filepath.Rel(root, file)
		rel = filepath.ToSlash(rel)
		stat, err := os.Stat(file)
		if err != nil {
			panic(err)
		}
		header, err := zip.FileInfoHeader(stat)
		if err != nil {
			panic(err)
		}
		header.Name = rel
		header.Method = zip.Deflate
		writer, err := z.CreateHeader(header)
		if err != nil {
			panic(err)
		}
		f, err := os.Open(file)
		if err != nil {
			panic(err)
		}
		_, err = io.Copy(writer, f)
		_ = f.Close()
		if err != nil {
			panic(err)
		}
	}
	if err := z.Close(); err != nil {
		panic(err)
	}
	if err := out.Close(); err != nil {
		panic(err)
	}
	fmt.Println("Created", os.Args[2], "files", len(files))
}
