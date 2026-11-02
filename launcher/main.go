// OMNI-CODE launcher. The Rust core owns the application window.
package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const coreURL = "http://127.0.0.1:47321/"

func main() {
	fmt.Println("OMNI-CODE")
	if healthy() {
		fmt.Println("OMNI-CODE is already running. Close that window first.")
		os.Exit(1)
	}
	binary, err := findCore()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	fmt.Println("Starting", binary)
	cmd := exec.Command(binary)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func healthy() bool {
	client := http.Client{Timeout: 400 * time.Millisecond}
	resp, err := client.Get(coreURL + "api/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func findCore() (string, error) {
	dirs := []string{}
	if exe, err := os.Executable(); err == nil {
		dirs = append(dirs, filepath.Dir(exe))
	}
	if cwd, err := os.Getwd(); err == nil {
		dirs = append(dirs, cwd)
	}
	rels := []string{
		filepath.Join("..", "core", "target", "release", "omni-core.exe"),
		filepath.Join("..", "core", "target", "debug", "omni-core.exe"),
		filepath.Join("core", "target", "release", "omni-core.exe"),
		filepath.Join("core", "target", "debug", "omni-core.exe"),
	}
	for _, dir := range dirs {
		for _, rel := range rels {
			candidate := filepath.Clean(filepath.Join(dir, rel))
			info, err := os.Stat(candidate)
			if err == nil && !info.IsDir() {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("omni-core.exe not found; build it with: cargo build --manifest-path core/Cargo.toml")
}
