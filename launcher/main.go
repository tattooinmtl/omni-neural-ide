// OMNI-CODE launcher. Asks Ultra or Plain, then starts the Rust core.
package main

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const coreURL = "http://127.0.0.1:47321/"

func main() {
	fmt.Println("========================================")
	fmt.Println("  OMNI-CODE Launcher")
	fmt.Println("========================================")
	fmt.Println()

	if healthy() {
		fmt.Println("OMNI-CODE is already running. Close that window first.")
		os.Exit(1)
	}

	style := askStyle()
	fmt.Printf("\nStarting OMNI-CODE %s...\n", style)

	binary, err := findCore()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	cmd := exec.Command(binary, "--style", style)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = append(os.Environ(), "OMNI_STYLE="+style)

	if err := cmd.Start(); err != nil {
		fmt.Println("Failed to start:", err)
		os.Exit(1)
	}

	fmt.Println("Core started. Waiting for window...")
	waitForHealth()
	fmt.Println("Ready.")
	cmd.Wait()
}

func askStyle() string {
	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Println("Choose version:")
		fmt.Println("  1) OMNI-CODE Ultra  (animated, electrified, particles)")
		fmt.Println("  2) OMNI-CODE        (plain, traditional)")
		fmt.Print("Enter 1 or 2: ")
		line, _ := reader.ReadString('\n')
		line = strings.TrimSpace(line)
		switch line {
		case "1", "ultra", "Ultra", "ULTRA":
			return "ultra"
		case "2", "plain", "Plain", "PLAIN":
			return "plain"
		default:
			fmt.Println("Invalid choice. Try again.")
		}
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

func waitForHealth() {
	for i := 0; i < 30; i++ {
		if healthy() {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
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
