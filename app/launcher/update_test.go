package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestParseSemver(t *testing.T) {
	v, ok := parseSemver("v1.1.0")
	if !ok || v != [3]int{1, 1, 0} {
		t.Fatalf("got %v %v", v, ok)
	}
	v, ok = parseSemver("1.0.3")
	if !ok || v != [3]int{1, 0, 3} {
		t.Fatalf("got %v %v", v, ok)
	}
}

func TestVersionLess(t *testing.T) {
	if !versionLess("1.0.3", "1.1.0") {
		t.Fatal("1.0.3 should be < 1.1.0")
	}
	if versionLess("1.1.0", "1.1.0") {
		t.Fatal("equal should not be less")
	}
	if versionLess("1.2.0", "1.1.9") {
		t.Fatal("1.2.0 should not be < 1.1.9")
	}
}

func TestVerifySHA256(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "OMNI-CODE-Setup-1.1.0.exe")
	data := []byte("fake-setup-bytes")
	if err := os.WriteFile(f, data, 0o644); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	sums := filepath.Join(dir, "SHA256SUMS.txt")
	line := hex.EncodeToString(sum[:]) + "  OMNI-CODE-Setup-1.1.0.exe\n"
	if err := os.WriteFile(sums, []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := verifySHA256(f, sums); err != nil {
		t.Fatal(err)
	}
}

func TestMockLatestReleaseJSON(t *testing.T) {
	rel := ghRelease{TagName: "v1.1.0", Assets: []ghAsset{
		{Name: "OMNI-CODE-Setup-1.1.0.exe", BrowserDownloadURL: "http://example/setup.exe"},
		{Name: "SHA256SUMS.txt", BrowserDownloadURL: "http://example/sums"},
	}}
	b, _ := json.Marshal(rel)
	var got ghRelease
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if !versionLess("1.0.3", got.TagName) {
		t.Fatal("should detect update")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(b)
	}))
	defer srv.Close()
	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var decoded ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.TagName != "v1.1.0" {
		t.Fatalf("tag %s", decoded.TagName)
	}
}

func TestEffectiveLocalIgnoresStaleFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "version"), []byte("1.2.2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := effectiveLocalVersion(dir)
	if got != version {
		t.Fatalf("effectiveLocalVersion=%s want embedded %s", got, version)
	}
	if versionLess(got, version) {
		t.Fatal("running binary must not be less than itself")
	}
}

func TestVersionEq(t *testing.T) {
	if !versionEq("1.2.4", "v1.2.4") {
		t.Fatal("expected equal")
	}
	if versionEq("1.2.4", "1.2.5") {
		t.Fatal("expected not equal")
	}
}
