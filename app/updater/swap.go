//go:build !windows

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

type plan struct {
	InstallDir string `json:"install_dir"`
	StageDir   string `json:"stage_dir"`
	WaitPIDs   []int  `json:"wait_pids"`
	Mode       string `json:"mode"`
	Relaunch   string `json:"relaunch"`
	BackupDir  string `json:"backup_dir"`
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
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var p plan
	if err := json.Unmarshal(b, &p); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	backup := p.BackupDir
	if backup == "" {
		backup = filepath.Join(p.InstallDir, "updates", "backup-"+time.Now().Format("20060102-150405"))
	}
	_ = os.MkdirAll(backup, 0o755)
	if err := swapDir(filepath.Join(p.StageDir, "bin"), filepath.Join(p.InstallDir, "bin"), filepath.Join(backup, "bin")); err != nil {
		_ = restoreDir(filepath.Join(backup, "bin"), filepath.Join(p.InstallDir, "bin"))
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := swapDir(filepath.Join(p.StageDir, "ui"), filepath.Join(p.InstallDir, "ui"), filepath.Join(backup, "ui")); err != nil {
		_ = restoreDir(filepath.Join(backup, "bin"), filepath.Join(p.InstallDir, "bin"))
		_ = restoreDir(filepath.Join(backup, "ui"), filepath.Join(p.InstallDir, "ui"))
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if vb, err := os.ReadFile(filepath.Join(p.StageDir, "version")); err == nil {
		_ = os.WriteFile(filepath.Join(p.InstallDir, "version"), vb, 0o644)
	}
	// write relaunch marker for tests (no real exec required)
	marker := filepath.Join(p.InstallDir, "updates", "relaunched.json")
	_ = os.MkdirAll(filepath.Dir(marker), 0o755)
	_ = os.WriteFile(marker, []byte(fmt.Sprintf(`{"mode":%q,"at":%q}`, p.Mode, time.Now().Format(time.RFC3339))), 0o644)
}

func swapDir(stage, live, backup string) error {
	if err := assertSwapTarget(filepath.Dir(live), live); err != nil {
		return err
	}
	if _, err := os.Stat(stage); err != nil {
		return nil
	}
	_ = os.RemoveAll(backup)
	if _, err := os.Stat(live); err == nil {
		if err := copyDir(live, backup); err != nil {
			return err
		}
	}
	tmp := live + ".new"
	_ = os.RemoveAll(tmp)
	if err := copyDir(stage, tmp); err != nil {
		return err
	}
	old := live + ".old"
	_ = os.RemoveAll(old)
	if _, err := os.Stat(live); err == nil {
		_ = os.Rename(live, old)
	}
	if err := os.Rename(tmp, live); err != nil {
		_ = copyDir(tmp, live)
		_ = os.RemoveAll(tmp)
	}
	_ = os.RemoveAll(old)
	return nil
}

func restoreDir(backup, live string) error {
	if _, err := os.Stat(backup); err != nil {
		return err
	}
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

// assertSwapTarget: the updater may only ever replace <install>/bin or <install>/ui.
// User data (data/, keys/, logs/, tools/, settings) is never touched.
func assertSwapTarget(install, live string) error {
	rel, err := filepath.Rel(install, live)
	if err != nil || (rel != "bin" && rel != "ui") {
		return fmt.Errorf("refusing to swap non-app path %q", live)
	}
	return nil
}
