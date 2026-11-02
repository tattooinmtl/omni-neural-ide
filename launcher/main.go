// OMNI-CODE launcher.
//
// Starts the Rust core which opens a native window.
// No browser. No localhost link.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type ProviderConfig struct {
	MiniMaxKey    string `json:"minimax_key"`
	MiniMaxModel  string `json:"minimax_model"`
	MiniMaxBase   string `json:"minimax_base"`
	MiniMaxRPM    int    `json:"minimax_rpm"`
	MiniMaxTPM    int    `json:"minimax_tpm"`
	NvidiaKey     string `json:"nvidia_key"`
	NvidiaModel   string `json:"nvidia_model"`
	NvidiaBase    string `json:"nvidia_base"`
	NvidiaRPM     int    `json:"nvidia_rpm"`
	NvidiaMaxTools int   `json:"nvidia_max_tools"`
	SandboxPath   string `json:"sandbox_path"`
	Style         string `json:"style"`
}

const coreURL = "http://127.0.0.1:47321/"
const launcherVersion = "v0.3.0"

func main() {
	fmt.Println("========================================")
	fmt.Printf("  OMNI-CODE Launcher %s\n", launcherVersion)
	fmt.Println("========================================")
	fmt.Println()

	if healthy() {
		fmt.Println("OMNI-CODE is already running. Close that window first.")
		os.Exit(1)
	}

	cfg := loadConfig()

	style := askStyle()
	cfg.Style = style
	saveConfig(cfg)

	fmt.Printf("\nStarting OMNI-CODE %s...\n", style)

	binary, err := findCore()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	info, _ := os.Stat(binary)
	fmt.Printf("Using binary: %s\n", binary)
	fmt.Printf("Modified: %s\n", info.ModTime().Format("2006-01-02 15:04:05"))

	cmd := exec.Command(binary, "--style", style)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	env := os.Environ()
	env = append(env, "OMNI_STYLE="+style)
	env = append(env, "OMNI_MINIMAX_KEY="+cfg.MiniMaxKey)
	env = append(env, "OMNI_MINIMAX_MODEL="+cfg.MiniMaxModel)
	env = append(env, "OMNI_MINIMAX_BASE="+cfg.MiniMaxBase)
	env = append(env, fmt.Sprintf("OMNI_MINIMAX_RPM=%d", cfg.MiniMaxRPM))
	env = append(env, fmt.Sprintf("OMNI_MINIMAX_TPM=%d", cfg.MiniMaxTPM))
	env = append(env, "OMNI_NVIDIA_KEY="+cfg.NvidiaKey)
	env = append(env, "OMNI_NVIDIA_MODEL="+cfg.NvidiaModel)
	env = append(env, "OMNI_NVIDIA_BASE="+cfg.NvidiaBase)
	env = append(env, fmt.Sprintf("OMNI_NVIDIA_RPM=%d", cfg.NvidiaRPM))
	env = append(env, fmt.Sprintf("OMNI_NVIDIA_MAX_TOOLS=%d", cfg.NvidiaMaxTools))
	env = append(env, "OMNI_SANDBOX="+cfg.SandboxPath)
	cmd.Env = env

	if err := cmd.Start(); err != nil {
		fmt.Println("Failed to start:", err)
		os.Exit(1)
	}

	fmt.Println("Opening native window...")
	waitForHealth()
	fmt.Println("Window opened.")
	cmd.Wait()
}

func loadConfig() ProviderConfig {
	defaults := ProviderConfig{
		MiniMaxModel:   "MiniMax-M3.1-Flash",
		MiniMaxBase:    "https://api.minimax.io/v1",
		MiniMaxRPM:     200,
		MiniMaxTPM:     10000000,
		NvidiaModel:    "nvidia/nemotron-3.5-lightning-30b-a3b",
		NvidiaBase:     "https://integrate.api.nvidia.com/v1",
		NvidiaRPM:      40,
		NvidiaMaxTools: 20,
		SandboxPath:    filepath.Join(os.Getenv("USERPROFILE"), ".omni-neural-ide", "sandbox"),
		Style:          "ultra",
	}
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, ".omni-neural-ide", "launcher-config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return defaults
	}
	var cfg ProviderConfig
	if json.Unmarshal(data, &cfg) != nil {
		return defaults
	}
	if cfg.MiniMaxModel == "" {
		cfg.MiniMaxModel = defaults.MiniMaxModel
	}
	if cfg.MiniMaxBase == "" {
		cfg.MiniMaxBase = defaults.MiniMaxBase
	}
	if cfg.NvidiaModel == "" {
		cfg.NvidiaModel = defaults.NvidiaModel
	}
	if cfg.NvidiaBase == "" {
		cfg.NvidiaBase = defaults.NvidiaBase
	}
	if cfg.NvidiaMaxTools == 0 {
		cfg.NvidiaMaxTools = defaults.NvidiaMaxTools
	}
	if cfg.SandboxPath == "" {
		cfg.SandboxPath = defaults.SandboxPath
	}
	return cfg
}

func saveConfig(cfg ProviderConfig) {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".omni-neural-ide")
	os.MkdirAll(dir, 0755)
	path := filepath.Join(dir, "launcher-config.json")
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(path, data, 0600)
}

func askStyle() string {
	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Println("Choose version:")
		fmt.Println("  1) OMNI-CODE Ultra")
		fmt.Println("  2) OMNI-CODE Plain")
		fmt.Print("Enter 1 or 2: ")
		line, _ := reader.ReadString('\n')
		line = strings.TrimSpace(line)
		switch line {
		case "1", "ultra", "Ultra":
			return "ultra"
		case "2", "plain", "Plain":
			return "plain"
		default:
			fmt.Println("Invalid choice.")
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
