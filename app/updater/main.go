//go:build windows

// OMNI-CODE updater helper — waits for app PIDs, swaps bin/ + ui/, relaunches.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type plan struct {
	InstallDir string   `json:"install_dir"`
	StageDir   string   `json:"stage_dir"`
	WaitPIDs   []int    `json:"wait_pids"`
	Mode       string   `json:"mode"`
	Relaunch   string   `json:"relaunch"` // path to launcher.exe
	BackupDir  string   `json:"backup_dir"`
}

func main() {
	planPath := flag.String("plan", "", "path to update plan JSON")
	flag.Parse()
	if *planPath == "" {
		fmt.Fprintln(os.Stderr, "omni-updater: -plan required")
		os.Exit(2)
	}
	b, err := os.ReadFile(*planPath)
	if err != nil {
		fatal(err)
	}
	var p plan
	if err := json.Unmarshal(b, &p); err != nil {
		fatal(err)
	}
	if p.InstallDir == "" || p.StageDir == "" {
		fatal(fmt.Errorf("install_dir and stage_dir required"))
	}
	logf := func(f string, a ...any) {
		line := fmt.Sprintf(f, a...) + "\n"
		_ = appendFile(filepath.Join(p.InstallDir, "logs", "updater.log"), line)
	}
	logf("updater start plan=%s", *planPath)

	// Wait for PIDs to exit (max ~60s)
	deadline := time.Now().Add(60 * time.Second)
	for _, pid := range p.WaitPIDs {
		for processAlive(pid) && time.Now().Before(deadline) {
			time.Sleep(200 * time.Millisecond)
		}
		if processAlive(pid) {
			logf("pid %d still alive — continuing anyway", pid)
		}
	}
	time.Sleep(400 * time.Millisecond)

	backup := p.BackupDir
	if backup == "" {
		backup = filepath.Join(p.InstallDir, "updates", "backup-"+time.Now().Format("20060102-150405"))
	}
	_ = os.MkdirAll(backup, 0o755)
	_ = os.MkdirAll(filepath.Join(p.InstallDir, "logs"), 0o755)

	// Swap bin/ and ui/ with rollback
	if err := swapDir(filepath.Join(p.StageDir, "bin"), filepath.Join(p.InstallDir, "bin"), filepath.Join(backup, "bin"), logf); err != nil {
		logf("swap bin failed: %v — rollback", err)
		_ = restoreDir(filepath.Join(backup, "bin"), filepath.Join(p.InstallDir, "bin"), logf)
		os.Exit(1)
	}
	if err := swapDir(filepath.Join(p.StageDir, "ui"), filepath.Join(p.InstallDir, "ui"), filepath.Join(backup, "ui"), logf); err != nil {
		logf("swap ui failed: %v — rollback", err)
		_ = restoreDir(filepath.Join(backup, "bin"), filepath.Join(p.InstallDir, "bin"), logf)
		_ = restoreDir(filepath.Join(backup, "ui"), filepath.Join(p.InstallDir, "ui"), logf)
		os.Exit(1)
	}
	// version file if staged
	if vb, err := os.ReadFile(filepath.Join(p.StageDir, "version")); err == nil {
		_ = os.WriteFile(filepath.Join(p.InstallDir, "version"), vb, 0o644)
	}
	logf("swap ok — relaunching")

	relaunch := p.Relaunch
	if relaunch == "" {
		relaunch = filepath.Join(p.InstallDir, "bin", "launcher.exe")
	}
	mode := p.Mode
	if mode == "" {
		mode = "plain"
	}
	cmd := exec.Command(relaunch, "--mode", mode)
	cmd.Dir = p.InstallDir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000008} // DETACHED_PROCESS
	if err := cmd.Start(); err != nil {
		logf("relaunch failed: %v", err)
		os.Exit(1)
	}
	logf("relaunch pid=%d mode=%s", cmd.Process.Pid, mode)
}

func swapDir(stage, live, backup string, logf func(string, ...any)) error {
	if _, err := os.Stat(stage); err != nil {
		logf("stage missing %s — skip", stage)
		return nil
	}
	_ = os.RemoveAll(backup)
	if _, err := os.Stat(live); err == nil {
		if err := copyDir(live, backup); err != nil {
			return fmt.Errorf("backup: %w", err)
		}
	}
	_ = os.MkdirAll(filepath.Dir(live), 0o755)
	// Replace live with stage contents
	tmp := live + ".new"
	_ = os.RemoveAll(tmp)
	if err := copyDir(stage, tmp); err != nil {
		return err
	}
	old := live + ".old"
	_ = os.RemoveAll(old)
	if _, err := os.Stat(live); err == nil {
		if err := os.Rename(live, old); err != nil {
			// fallback copy+remove
			_ = copyDir(live, old)
			_ = os.RemoveAll(live)
		}
	}
	if err := os.Rename(tmp, live); err != nil {
		_ = copyDir(tmp, live)
		_ = os.RemoveAll(tmp)
	}
	_ = os.RemoveAll(old)
	return nil
}

func restoreDir(backup, live string, logf func(string, ...any)) error {
	if _, err := os.Stat(backup); err != nil {
		return err
	}
	logf("restoring %s", live)
	_ = os.RemoveAll(live)
	return copyDir(backup, live)
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := syscall.OpenProcess(0x1000, false, uint32(pid)) // PROCESS_QUERY_LIMITED_INFORMATION
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)
	var code uint32
	err = syscall.GetExitCodeProcess(h, &code)
	if err != nil {
		return false
	}
	return code == 259 // STILL_ACTIVE
}

func appendFile(path, line string) error {
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.WriteString(f, line)
	return err
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

var _ = strings.TrimSpace
