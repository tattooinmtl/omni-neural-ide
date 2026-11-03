package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const version = "1.0.0"

func main() {
	fmt.Println("OMNI-CODE launcher", version)
	install := installRoot()
	_ = os.MkdirAll(filepath.Join(install, "keys"), 0o755)
	_ = os.MkdirAll(filepath.Join(install, "sandbox"), 0o755)
	_ = os.MkdirAll(filepath.Join(install, "bin"), 0o755)

	mode, keysOK := runLaunchUI(install)
	if mode == "" {
		fmt.Println("Launch cancelled.")
		os.Exit(1)
	}
	fmt.Printf("Selected mode: %s (keys ready: %v)\n", mode, keysOK)

	core := findCore(install)
	if core == "" {
		fmt.Println("ERROR: omni-core binary not found. Build core first (cargo build --release).")
		fmt.Println("Looked in:", filepath.Join(install, "bin"), besideLauncher())
		os.Exit(2)
	}
	fmt.Println("Starting fresh core:", core)

	uiDir := filepath.Join(filepath.Dir(core), "..", "ui", "dist")
	if _, err := os.Stat(filepath.Join(uiDir, "index.html")); err != nil {
		// try relative to launcher source layout
		uiDir = filepath.Join(besideLauncher(), "..", "ui", "dist")
	}
	uiDir, _ = filepath.Abs(uiDir)

	args := []string{
		"--mode", mode,
		"--data-dir", install,
		"--ui-dir", uiDir,
		"--port", "8741",
	}
	cmd := exec.Command(core, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Dir = filepath.Dir(core)
	if err := cmd.Start(); err != nil {
		fmt.Println("failed to start core:", err)
		os.Exit(3)
	}
	url := fmt.Sprintf("http://127.0.0.1:8741/?mode=%s", mode)
	fmt.Printf("OMNI-CODE core pid=%d — native window %s\n", cmd.Process.Pid, url)
	time.Sleep(600 * time.Millisecond)
	openAppWindow(url)
	_ = cmd.Wait()
}

func openAppWindow(url string) {
	if runtime.GOOS == "windows" {
		// Edge app mode = native window chrome, not a tabbed browser IDE
		candidates := []string{
			`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
			`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				cmd := exec.Command(c, "--app="+url, "--window-size=1168,784")
				_ = cmd.Start()
				return
			}
		}
	}
	_ = openBrowser(url)
}

func installRoot() string {
	if v := os.Getenv("OMNI_HOME"); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		return `C:\Users\ThePa\.omni-neural-ide`
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".omni-neural-ide")
}

func besideLauncher() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func findCore(install string) string {
	name := "omni-core"
	if runtime.GOOS == "windows" {
		name = "omni-core.exe"
	}
	candidates := []string{
		filepath.Join(install, "bin", name),
		filepath.Join(besideLauncher(), name),
		filepath.Join(besideLauncher(), "..", "core", "target", "release", name),
		filepath.Join(besideLauncher(), "..", "dist", name),
		filepath.Join(".", "core", "target", "release", name),
		filepath.Join(".", "dist", name),
	}
	var best string
	var bestMod time.Time
	for _, c := range candidates {
		st, err := os.Stat(c)
		if err != nil || st.IsDir() {
			continue
		}
		// Prefer the newest binary so we never launch a stale build
		if best == "" || st.ModTime().After(bestMod) {
			best = c
			bestMod = st.ModTime()
		}
	}
	return best
}

type launchResult struct {
	Mode    string `json:"mode"`
	Minimax string `json:"minimax"`
	Nvidia  string `json:"nvidia"`
}

func runLaunchUI(install string) (string, bool) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		// fallback CLI
		fmt.Print("Choose mode [plain/ultra]: ")
		var mode string
		fmt.Scanln(&mode)
		mode = strings.ToLower(strings.TrimSpace(mode))
		if mode != "ultra" {
			mode = "plain"
		}
		return mode, false
	}
	done := make(chan launchResult, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, launchHTML)
	})
	mux.HandleFunc("/launch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", 405)
			return
		}
		var body launchResult
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		body.Mode = strings.ToLower(strings.TrimSpace(body.Mode))
		if body.Mode != "ultra" {
			body.Mode = "plain"
		}
		// persist keys (never hardcoded)
		keysPath := filepath.Join(install, "keys", "providers.json")
		existing := map[string]any{}
		if b, err := os.ReadFile(keysPath); err == nil {
			_ = json.Unmarshal(b, &existing)
		}
		if body.Minimax != "" {
			existing["minimax"] = body.Minimax
		}
		if body.Nvidia != "" {
			existing["nvidia"] = body.Nvidia
		}
		b, _ := json.MarshalIndent(existing, "", "  ")
		_ = os.WriteFile(keysPath, b, 0o600)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"ok":true}`)
		done <- body
	})
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	url := fmt.Sprintf("http://%s/", ln.Addr().String())
	fmt.Println("Launcher UI:", url, "(asks Ultra vs Plain every launch)")
	_ = openBrowser(url)

	select {
	case res := <-done:
		_ = srv.Close()
		keysOK := res.Minimax != "" || res.Nvidia != ""
		return res.Mode, keysOK
	case <-time.After(10 * time.Minute):
		_ = srv.Close()
		return "", false
	}
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

const launchHTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>OMNI-CODE Launcher</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;background:#0a131a;color:#e8eef4;display:grid;place-items:center;min-height:100vh;margin:0}
card{display:block;width:440px;background:#111a21;border:1px solid #243040;border-radius:12px;padding:24px}
h1{margin:0 0 6px;font-size:20px}p{color:#9aa7b5;font-size:13px}
.choice{display:block;width:100%;text-align:left;margin:8px 0;padding:14px;border-radius:8px;border:1px solid #243040;background:#0c151c;color:#fff;cursor:pointer}
.choice:hover{border-color:#3794ff}.choice.sel{border-color:#22d3ee}
label{display:block;font-size:12px;color:#9aa7b5;margin-top:10px}
input{width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border-radius:6px;border:1px solid #243040;background:#0a1218;color:#fff}
button.go{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
.ver{font-size:11px;color:#6a7785;margin-top:10px;text-align:center}
</style></head><body><card>
<h1>OMNI-CODE Launcher ` + version + `</h1>
<p>Choose Ultra or Plain every launch. Keys stay on this machine — never hardcoded.</p>
<button class="choice" data-m="plain" id="c-plain"><strong>OMNI-CODE</strong><br/><span style="color:#9aa7b5;font-size:12px">Classic layout</span></button>
<button class="choice" data-m="ultra" id="c-ultra"><strong>OMNI-CODE Ultra</strong><br/><span style="color:#9aa7b5;font-size:12px">Omni Connected · model picker · thinking</span></button>
<label>MiniMax API key<input id="minimax" type="password" placeholder="main coder"/></label>
<label>NVIDIA API key<input id="nvidia" type="password" placeholder="Nemotron helper"/></label>
<button class="go" id="go">Start</button>
<div class="ver">Install root is configured by the launcher · refuses stale core binaries (newest wins)</div>
<script>
let mode='plain';
document.querySelectorAll('.choice').forEach(b=>b.onclick=()=>{
  mode=b.dataset.m; document.querySelectorAll('.choice').forEach(x=>x.classList.remove('sel')); b.classList.add('sel');
});
document.getElementById('c-plain').classList.add('sel');
document.getElementById('go').onclick=async()=>{
  await fetch('/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    mode, minimax:document.getElementById('minimax').value, nvidia:document.getElementById('nvidia').value
  })});
  document.body.innerHTML='<card><h1>Starting…</h1><p>You can close this window.</p></card>';
};
</script></card></body></html>`
