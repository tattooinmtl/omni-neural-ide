// OMNI-CODE launcher with provider settings UI.
//
// Serves a small local page so you can set API keys and rate limits,
// then starts the Rust core with the chosen style.
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
const launcherPort = 47320
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
	fmt.Println("Open http://127.0.0.1:47320 in a browser to set providers.")
	fmt.Println("Or press Enter to continue with saved settings.")

	go serveSettings(&cfg)

	reader := bufio.NewReader(os.Stdin)
	fmt.Print("Press Enter when ready (or after saving settings in the browser)... ")
	reader.ReadString('\n')

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

	fmt.Println("Core started. Waiting for window...")
	waitForHealth()
	fmt.Println("Ready.")
	cmd.Wait()
}

func serveSettings(cfg *ProviderConfig) {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			r.ParseForm()
			cfg.MiniMaxKey = r.FormValue("minimax_key")
			cfg.MiniMaxModel = r.FormValue("minimax_model")
			cfg.MiniMaxBase = r.FormValue("minimax_base")
			fmt.Sscanf(r.FormValue("minimax_rpm"), "%d", &cfg.MiniMaxRPM)
			fmt.Sscanf(r.FormValue("minimax_tpm"), "%d", &cfg.MiniMaxTPM)
			cfg.NvidiaKey = r.FormValue("nvidia_key")
			cfg.NvidiaModel = r.FormValue("nvidia_model")
			cfg.NvidiaBase = r.FormValue("nvidia_base")
			fmt.Sscanf(r.FormValue("nvidia_rpm"), "%d", &cfg.NvidiaRPM)
			fmt.Sscanf(r.FormValue("nvidia_max_tools"), "%d", &cfg.NvidiaMaxTools)
			cfg.SandboxPath = r.FormValue("sandbox_path")
			cfg.Style = r.FormValue("style")
			saveConfig(*cfg)
			http.Redirect(w, r, "/?saved=1", http.StatusSeeOther)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, settingsHTML(*cfg))
	})
	fmt.Println("Settings UI: http://127.0.0.1:47320")
	http.ListenAndServe(":47320", nil)
}

func settingsHTML(cfg ProviderConfig) string {
	saved := ""
	if cfg.Style != "" {
		saved = `<p style="color:green;">Saved.</p>`
	}
	return fmt.Sprintf(`<!doctype html>
<html><head><meta charset="utf-8"><title>OMNI-CODE Launcher</title>
<style>
body{font:14px system-ui;background:#0e1117;color:#e6edf3;margin:0;padding:20px;}
.box{max-width:560px;margin:auto;background:#161b22;border:1px solid #21262d;border-radius:8px;padding:20px;}
h2{margin:0 0 12px;font-size:16px;}
label{display:block;margin:8px 0 2px;font-size:12px;color:#8b949e;}
input,select{width:100%%;padding:6px 8px;background:#0d1117;border:1px solid #21262d;color:#e6edf3;border-radius:4px;}
button{margin-top:14px;background:#58a6ff;color:#fff;border:0;padding:8px 16px;border-radius:4px;cursor:pointer;}
.note{font-size:11px;color:#8b949e;margin-top:4px;}
</style></head><body>
<div class="box">
<h2>OMNI-CODE Provider Settings <span style="font-size:12px;color:#8b949e;">%s</span></h2>
%s
<form method="post">
<h3>MiniMax (main agent)</h3>
<label>API Key</label><input name="minimax_key" value="%s" type="password">
<label>Model</label><input name="minimax_model" value="%s">
<label>Base URL</label><input name="minimax_base" value="%s">
<label>RPM limit</label><input name="minimax_rpm" type="number" value="%d">
<label>TPM limit</label><input name="minimax_tpm" type="number" value="%d">
<div class="note">Paid: 200 RPM / 10M TPM. Free: 20 RPM / 1M TPM.</div>

<h3>NVIDIA NIM (assistant sub-agent / sandbox)</h3>
<label>API Key</label><input name="nvidia_key" value="%s" type="password">
<label>Model</label><input name="nvidia_model" value="%s">
<label>Base URL</label><input name="nvidia_base" value="%s">
<label>RPM limit</label><input name="nvidia_rpm" type="number" value="%d">
<label>Max tool calls / min</label><input name="nvidia_max_tools" type="number" value="%d">
<div class="note">Free tier: 40 RPM. Keep tool calls low to avoid 400s. TPM is gray.</div>

<h3>Sandbox</h3>
<label>Sandbox folder (NIM can only write here)</label>
<input name="sandbox_path" value="%s">
<div class="note">NIM can read outside, write only inside. Main agent reads results from here.</div>

<h3>Version</h3>
<label>Style</label>
<select name="style">
<option value="ultra" %s>Ultra</option>
<option value="plain" %s>Plain</option>
</select>

<button type="submit">Save</button>
</form>
<p style="font-size:12px;color:#8b949e;margin-top:16px;">After saving, go back to the terminal and press Enter to start.</p>
</div></body></html>`,
		launcherVersion, saved,
		cfg.MiniMaxKey, cfg.MiniMaxModel, cfg.MiniMaxBase, cfg.MiniMaxRPM, cfg.MiniMaxTPM,
		cfg.NvidiaKey, cfg.NvidiaModel, cfg.NvidiaBase, cfg.NvidiaRPM, cfg.NvidiaMaxTools,
		cfg.SandboxPath,
		selected(cfg.Style, "ultra"), selected(cfg.Style, "plain"),
	)
}

func selected(cur, val string) string {
	if cur == val {
		return "selected"
	}
	return ""
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
