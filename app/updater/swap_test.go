package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSwapAndRollback(t *testing.T) {
	root := t.TempDir()
	install := filepath.Join(root, "install")
	stage := filepath.Join(root, "stage")
	_ = os.MkdirAll(filepath.Join(install, "bin"), 0o755)
	_ = os.MkdirAll(filepath.Join(install, "ui", "dist"), 0o755)
	_ = os.MkdirAll(filepath.Join(stage, "bin"), 0o755)
	_ = os.MkdirAll(filepath.Join(stage, "ui", "dist"), 0o755)
	_ = os.WriteFile(filepath.Join(install, "bin", "omni-core.exe"), []byte("OLDCORE"), 0o755)
	_ = os.WriteFile(filepath.Join(install, "ui", "dist", "index.html"), []byte("OLDUI"), 0o644)
	_ = os.WriteFile(filepath.Join(install, "version"), []byte("1.1.2\n"), 0o644)
	_ = os.MkdirAll(filepath.Join(install, "keys"), 0o755)
	_ = os.MkdirAll(filepath.Join(install, "data"), 0o755)
	_ = os.WriteFile(filepath.Join(install, "keys", "providers.json"), []byte(`{"minimax":"sk-KEEP"}`), 0o600)
	_ = os.WriteFile(filepath.Join(install, "data", "omni.db"), []byte("DBBYTES"), 0o600)
	// a hostile stage that tries to ship keys/data must be ignored
	_ = os.MkdirAll(filepath.Join(stage, "keys"), 0o755)
	_ = os.WriteFile(filepath.Join(stage, "keys", "providers.json"), []byte(`{}`), 0o600)
	_ = os.WriteFile(filepath.Join(stage, "bin", "omni-core.exe"), []byte("NEWCORE"), 0o755)
	_ = os.WriteFile(filepath.Join(stage, "ui", "dist", "index.html"), []byte("NEWUI"), 0o644)
	_ = os.WriteFile(filepath.Join(stage, "version"), []byte("1.2.0\n"), 0o644)

	planPath := filepath.Join(root, "plan.json")
	plan := map[string]any{
		"install_dir": install,
		"stage_dir":   stage,
		"wait_pids":   []int{},
		"mode":        "ultra",
		"backup_dir":  filepath.Join(install, "updates", "backup-test"),
	}
	b, _ := json.Marshal(plan)
	_ = os.WriteFile(planPath, b, 0o644)

	// Build + run updater for this OS
	bin := filepath.Join(root, "omni-updater")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = "."
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	run := exec.Command(bin, "-plan", planPath)
	if out, err := run.CombinedOutput(); err != nil {
		t.Fatalf("run: %v\n%s", err, out)
	}
	got, _ := os.ReadFile(filepath.Join(install, "bin", "omni-core.exe"))
	if string(got) != "NEWCORE" {
		t.Fatalf("core not swapped: %q", got)
	}
	gotUI, _ := os.ReadFile(filepath.Join(install, "ui", "dist", "index.html"))
	if string(gotUI) != "NEWUI" {
		t.Fatalf("ui not swapped: %q", gotUI)
	}
	ver, _ := os.ReadFile(filepath.Join(install, "version"))
	if string(ver) != "1.2.0\n" {
		t.Fatalf("version: %q", ver)
	}
	if k, _ := os.ReadFile(filepath.Join(install, "keys", "providers.json")); string(k) != `{"minimax":"sk-KEEP"}` {
		t.Fatalf("keys overwritten: %q", k)
	}
	if d, _ := os.ReadFile(filepath.Join(install, "data", "omni.db")); string(d) != "DBBYTES" {
		t.Fatalf("db touched: %q", d)
	}
	bak, _ := os.ReadFile(filepath.Join(install, "updates", "backup-test", "bin", "omni-core.exe"))
	if string(bak) != "OLDCORE" {
		t.Fatalf("backup missing: %q", bak)
	}
	if _, err := os.Stat(filepath.Join(install, "updates", "relaunched.json")); err != nil && runtime.GOOS != "windows" {
		t.Fatalf("relaunch marker: %v", err)
	}
}
