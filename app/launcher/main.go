// OMNI-CODE native Win32 launcher (no browser, no localhost UI).
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/rodrigocfd/windigo/co"
	"github.com/rodrigocfd/windigo/ui"
	"github.com/rodrigocfd/windigo/win"
)

const version = "1.0.1"

type launchChoice struct {
	mode    string
	minimax string
	nvidia  string
	ok      bool
}

func main() {
	runtime.LockOSThread()

	install := installRoot()
	_ = os.MkdirAll(filepath.Join(install, "keys"), 0o755)
	_ = os.MkdirAll(filepath.Join(install, "sandbox"), 0o755)
	_ = os.MkdirAll(filepath.Join(install, "bin"), 0o755)
	_ = os.MkdirAll(filepath.Join(install, "logs"), 0o755)

	logPath := filepath.Join(install, "logs", "launcher.log")
	logf, _ := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if logf != nil {
		defer logf.Close()
		fmt.Fprintf(logf, "\n==== launcher %s start %s install=%s ====\n", version, time.Now().Format(time.RFC3339), install)
	}
	log := func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		if logf != nil {
			fmt.Fprintln(logf, msg)
			_ = logf.Sync()
		}
	}

	choice := showNativeLauncher(install, log)
	if !choice.ok || choice.mode == "" {
		log("launch cancelled")
		return
	}
	log("selected mode=%s keys minimax=%v nvidia=%v", choice.mode, choice.minimax != "", choice.nvidia != "")

	if err := startCore(install, choice, log); err != nil {
		log("startCore error: %v", err)
		msgBox(0, fmt.Sprintf("OMNI-CODE failed to start:\n\n%v\n\nSee log:\n%s", err, logPath), "OMNI-CODE Launcher")
	}
}

func showNativeLauncher(install string, log func(string, ...any)) launchChoice {
	existing := loadKeys(install)

	brush, errBrush := win.CreateBrushIndirect(&win.LOGBRUSH{
		Style: co.BRS_SOLID,
		Color: win.RGB(0x0a, 0x13, 0x1a),
	})
	opts := ui.OptsMain().
		Title("OMNI-CODE Launcher " + version).
		Size(ui.Dpi(460, 340)).
		Center(true)
	if errBrush == nil {
		opts = opts.ClassBrush(brush)
	}

	wnd := ui.NewMain(opts)

	ui.NewStatic(wnd, ui.OptsStatic().
		Text("Choose Ultra or Plain. API keys stay on this machine.").
		Position(ui.Dpi(20, 16)).
		Size(ui.DpiX(420), ui.DpiY(20)))

	radios := ui.NewRadioGroup(
		wnd,
		ui.OptsRadioButton().
			Text("OMNI-CODE (Plain)").
			Position(ui.Dpi(20, 48)).
			Selected(true),
		ui.OptsRadioButton().
			Text("OMNI-CODE Ultra").
			Position(ui.Dpi(20, 74)),
	)

	ui.NewStatic(wnd, ui.OptsStatic().
		Text("MiniMax API key").
		Position(ui.Dpi(20, 112)))
	txtMinimax := ui.NewEdit(wnd, ui.OptsEdit().
		Position(ui.Dpi(20, 132)).
		Width(ui.DpiX(420)).
		CtrlStyle(co.ES_AUTOHSCROLL|co.ES_PASSWORD|co.ES_NOHIDESEL).
		Text(existing["minimax"]))

	ui.NewStatic(wnd, ui.OptsStatic().
		Text("NVIDIA API key").
		Position(ui.Dpi(20, 168)))
	txtNvidia := ui.NewEdit(wnd, ui.OptsEdit().
		Position(ui.Dpi(20, 188)).
		Width(ui.DpiX(420)).
		CtrlStyle(co.ES_AUTOHSCROLL|co.ES_PASSWORD|co.ES_NOHIDESEL).
		Text(existing["nvidia"]))

	btnLaunch := ui.NewButton(wnd, ui.OptsButton().
		Text("Launch").
		Position(ui.Dpi(20, 240)).
		Width(ui.DpiX(200)))
	btnCancel := ui.NewButton(wnd, ui.OptsButton().
		Text("Cancel").
		Position(ui.Dpi(240, 240)).
		Width(ui.DpiX(200)))

	ui.NewStatic(wnd, ui.OptsStatic().
		Text("Install: "+install).
		Position(ui.Dpi(20, 290)).
		Size(ui.DpiX(420), ui.DpiY(20)))

	result := launchChoice{}

	btnLaunch.On().BnClicked(func() {
		mode := "plain"
		if sel := radios.Selected(); sel != nil && sel.Index() == 1 {
			mode = "ultra"
		}
		minimax := strings.TrimSpace(txtMinimax.Text())
		nvidia := strings.TrimSpace(txtNvidia.Text())
		if err := saveKeys(install, minimax, nvidia); err != nil {
			log("saveKeys: %v", err)
			wnd.Hwnd().MessageBox("Could not save API keys:\n"+err.Error(), "OMNI-CODE", co.MB_ICONERROR)
			return
		}
		result = launchChoice{mode: mode, minimax: minimax, nvidia: nvidia, ok: true}
		_ = wnd.Hwnd().DestroyWindow()
	})
	btnCancel.On().BnClicked(func() {
		_ = wnd.Hwnd().DestroyWindow()
	})

	wnd.RunAsMain()
	return result
}

func startCore(install string, choice launchChoice, log func(string, ...any)) error {
	core := findCore(install)
	if core == "" {
		return fmt.Errorf("omni-core.exe not found next to the launcher or under:\n%s\\bin", install)
	}
	uiDir := resolveUIDir(install, core)
	if _, err := os.Stat(filepath.Join(uiDir, "index.html")); err != nil {
		return fmt.Errorf("UI not found (expected index.html).\nLooked at:\n%s\n\nReinstall OMNI-CODE.", uiDir)
	}
	uiDir, _ = filepath.Abs(uiDir)
	core, _ = filepath.Abs(core)

	args := []string{
		"--mode", choice.mode,
		"--data-dir", install,
		"--ui-dir", uiDir,
		"--port", "8741",
	}
	log("starting core=%s args=%v cwd=%s", core, args, filepath.Dir(core))

	cmd := exec.Command(core, args...)
	cmd.Dir = filepath.Dir(core)
	// Inherit nothing from a GUI parent; core logs to its own file.
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not spawn omni-core.exe:\n%w\n\nIf Windows complained about a missing DLL, reinstall v1.0.1 (bundles WebView2Loader.dll + libunwind.dll).", err)
	}
	log("core pid=%d", cmd.Process.Pid)

	// Detach wait in background so a crash still surfaces via core's own MessageBox;
	// launcher stays alive briefly to catch immediate spawn failures.
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("omni-core.exe exited immediately: %w\n\nCheck:\n%s", err, filepath.Join(install, "logs", "omni-core.log"))
		}
		return nil
	case <-time.After(3 * time.Second):
		// Still running — good. Leave it; launcher exits.
		log("core still running after 3s — launcher exiting")
		return nil
	}
}

func resolveUIDir(install, core string) string {
	candidates := []string{
		filepath.Join(filepath.Dir(core), "..", "ui", "dist"),
		filepath.Join(install, "ui", "dist"),
		filepath.Join(besideLauncher(), "..", "ui", "dist"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(filepath.Join(c, "index.html")); err == nil {
			return c
		}
	}
	return candidates[0]
}

func installRoot() string {
	if v := os.Getenv("OMNI_HOME"); v != "" {
		return v
	}
	beside := besideLauncher()
	if filepath.Base(beside) == "bin" {
		parent := filepath.Dir(beside)
		if _, err := os.Stat(filepath.Join(parent, "ui", "dist", "index.html")); err == nil {
			return parent
		}
		// Prefer parent even before UI check when we are clearly in an install layout.
		if _, err := os.Stat(filepath.Join(beside, "omni-core.exe")); err == nil {
			return parent
		}
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, ".omni-neural-ide")
}

func besideLauncher() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	resolved, err := filepath.EvalSymlinks(exe)
	if err == nil {
		exe = resolved
	}
	return filepath.Dir(exe)
}

func findCore(install string) string {
	name := "omni-core.exe"
	if runtime.GOOS != "windows" {
		name = "omni-core"
	}
	candidates := []string{
		filepath.Join(besideLauncher(), name),
		filepath.Join(install, "bin", name),
		filepath.Join(besideLauncher(), "..", "dist", name),
	}
	var best string
	var bestMod time.Time
	for _, c := range candidates {
		st, err := os.Stat(c)
		if err != nil || st.IsDir() {
			continue
		}
		if best == "" || st.ModTime().After(bestMod) {
			best = c
			bestMod = st.ModTime()
		}
	}
	return best
}

func loadKeys(install string) map[string]string {
	out := map[string]string{"minimax": "", "nvidia": ""}
	b, err := os.ReadFile(filepath.Join(install, "keys", "providers.json"))
	if err != nil {
		return out
	}
	var raw map[string]any
	if json.Unmarshal(b, &raw) != nil {
		return out
	}
	if v, ok := raw["minimax"].(string); ok {
		out["minimax"] = v
	}
	if v, ok := raw["nvidia"].(string); ok {
		out["nvidia"] = v
	}
	return out
}

func saveKeys(install string, minimax, nvidia string) error {
	path := filepath.Join(install, "keys", "providers.json")
	existing := map[string]any{}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &existing)
	}
	if minimax != "" {
		existing["minimax"] = minimax
	}
	if nvidia != "" {
		existing["nvidia"] = nvidia
	}
	b, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func msgBox(owner win.HWND, text, caption string) {
	_, _ = owner.MessageBox(text, caption, co.MB_ICONERROR)
}
