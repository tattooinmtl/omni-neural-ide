package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const githubLatestAPI = "https://api.github.com/repos/tattooinmtl/omni-neural-ide/releases/latest"

type ghRelease struct {
	TagName string    `json:"tag_name"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// parseSemver turns "v1.1.0" / "1.1.0" into [major,minor,patch].
func parseSemver(s string) ([3]int, bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "v")
	s = strings.TrimPrefix(s, "V")
	re := regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)`)
	m := re.FindStringSubmatch(s)
	if m == nil {
		return [3]int{}, false
	}
	a, _ := strconv.Atoi(m[1])
	b, _ := strconv.Atoi(m[2])
	c, _ := strconv.Atoi(m[3])
	return [3]int{a, b, c}, true
}

func versionLess(a, b string) bool {
	va, oka := parseSemver(a)
	vb, okb := parseSemver(b)
	if !oka || !okb {
		return false
	}
	for i := 0; i < 3; i++ {
		if va[i] < vb[i] {
			return true
		}
		if va[i] > vb[i] {
			return false
		}
	}
	return false
}

func writeVersionFile(install, ver string) {
	_ = os.MkdirAll(install, 0o755)
	_ = os.WriteFile(filepath.Join(install, "version"), []byte(strings.TrimSpace(ver)+"\n"), 0o644)
}

func readVersionFile(install string) string {
	b, err := os.ReadFile(filepath.Join(install, "version"))
	if err != nil {
		return version
	}
	return strings.TrimSpace(string(b))
}

// checkAndApplyUpdate queries GitHub releases. Fail-open on any error.
// status callback receives UI strings (green status line).
// Returns true if an update was applied and the process should exit (new setup relaunches).
func checkAndApplyUpdate(install string, status func(string), log func(string, ...any)) bool {
	status("Checking for updates…")
	client := &http.Client{Timeout: 12 * time.Second}
	req, err := http.NewRequest("GET", githubLatestAPI, nil)
	if err != nil {
		status("")
		return false
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "OMNI-CODE-Gateway/"+version)
	resp, err := client.Do(req)
	if err != nil {
		log("update check offline: %v", err)
		status("")
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		log("update check status %d", resp.StatusCode)
		status("")
		return false
	}
	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		log("update decode: %v", err)
		status("")
		return false
	}
	local := readVersionFile(install)
	if local == "" {
		local = version
	}
	if !versionLess(local, rel.TagName) {
		log("up to date local=%s remote=%s", local, rel.TagName)
		status("Up to date · v"+strings.TrimPrefix(local, "v"))
		time.Sleep(400 * time.Millisecond)
		status("")
		return false
	}
	status("Updating to " + rel.TagName + "…")
	log("update available %s -> %s", local, rel.TagName)

	var setupURL, sumsURL string
	for _, a := range rel.Assets {
		n := strings.ToLower(a.Name)
		if strings.HasPrefix(n, "omni-code-setup-") && strings.HasSuffix(n, ".exe") {
			setupURL = a.BrowserDownloadURL
		}
		if n == "sha256sums.txt" {
			sumsURL = a.BrowserDownloadURL
		}
	}
	if setupURL == "" {
		log("no setup asset in release")
		status("Update skipped (no setup)")
		time.Sleep(800 * time.Millisecond)
		status("")
		return false
	}

	tmpDir := filepath.Join(install, "logs", "update")
	_ = os.MkdirAll(tmpDir, 0o755)
	setupPath := filepath.Join(tmpDir, "OMNI-CODE-Setup-update.exe")
	if err := downloadFile(client, setupURL, setupPath); err != nil {
		log("download setup: %v", err)
		status("Update download failed")
		time.Sleep(800 * time.Millisecond)
		status("")
		return false
	}
	if sumsURL != "" {
		sumsPath := filepath.Join(tmpDir, "SHA256SUMS.txt")
		if err := downloadFile(client, sumsURL, sumsPath); err != nil {
			log("download sums: %v", err)
		} else if err := verifySHA256(setupPath, sumsPath); err != nil {
			log("sha256 verify failed: %v", err)
			status("Update checksum failed")
			time.Sleep(900 * time.Millisecond)
			status("")
			return false
		} else {
			log("sha256 ok")
		}
	}

	// Silent per-user upgrade; NSIS preserves keys/config/logs under same InstDir.
	cmd := exec.Command(setupPath, "/S")
	cmd.Dir = tmpDir
	if err := cmd.Start(); err != nil {
		log("spawn setup: %v", err)
		status("Update launch failed")
		time.Sleep(800 * time.Millisecond)
		status("")
		return false
	}
	log("spawned silent setup pid=%d", cmd.Process.Pid)
	status("Installing " + rel.TagName + "…")
	// New setup installs and can relaunch; exit this instance.
	return true
}

func downloadFile(client *http.Client, url, dest string) error {
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func verifySHA256(filePath, sumsPath string) error {
	b, err := os.ReadFile(sumsPath)
	if err != nil {
		return err
	}
	wantName := strings.ToLower(filepath.Base(filePath))
	var expected string
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[len(fields)-1], "*")
		if strings.EqualFold(filepath.Base(name), wantName) ||
			(strings.HasPrefix(strings.ToLower(name), "omni-code-setup-") && strings.HasSuffix(strings.ToLower(name), ".exe")) {
			// Prefer exact; also accept any setup exe line if updating via renamed temp file
			if strings.EqualFold(filepath.Base(name), wantName) || expected == "" {
				expected = fields[0]
			}
			if strings.EqualFold(filepath.Base(name), wantName) {
				break
			}
		}
		// SHA256SUMS lists OMNI-CODE-Setup-x.y.z.exe — match by prefix
		if strings.HasPrefix(strings.ToLower(filepath.Base(name)), "omni-code-setup-") && strings.HasSuffix(strings.ToLower(name), ".exe") {
			expected = fields[0]
		}
	}
	if expected == "" {
		return fmt.Errorf("no matching checksum line for %s", wantName)
	}
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	got := hex.EncodeToString(h.Sum(nil))
	if !strings.EqualFold(got, expected) {
		return fmt.Errorf("mismatch got=%s want=%s", got, expected)
	}
	return nil
}
