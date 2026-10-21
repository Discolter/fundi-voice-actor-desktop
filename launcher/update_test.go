package main

import (
	"archive/zip"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVersions(t *testing.T) {
	if compareVersion("1.10.0", "1.9.9") <= 0 {
		t.Fatal("semver mismatch")
	}
	if compareVersion("0.4.0", "0.4.0") != 0 {
		t.Fatal("same version mismatch")
	}
	if compareVersion("0.3.5", "0.4.0") >= 0 {
		t.Fatal("downgrade mismatch")
	}
}
func TestZIPTraversal(t *testing.T) {
	for _, p := range []string{"../evil", "/root/file", "C:/Windows/file", "foo\\bar", "foo/../../evil", "", "a//b"} {
		if safeZIPPath(p) {
			t.Fatalf("Accepted path %q", p)
		}
	}
	for _, p := range []string{"web/app.js", "Launch.ps1", "README.md"} {
		if !safeZIPPath(p) {
			t.Fatalf("Rejected valid path %q", p)
		}
	}
}
func TestCorruptBundleRejected(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "invalid.zip")
	f, _ := os.Create(p)
	z := zip.NewWriter(f)
	entry, _ := z.Create("../escape.txt")
	_, _ = entry.Write([]byte("no"))
	_ = z.Close()
	_ = f.Close()
	if err := unpackVerified(p, filepath.Join(dir, "stage")); err == nil {
		t.Fatal("zip-slip allowed")
	}
}
func TestManifestVerification(t *testing.T) {
	pub, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		t.Fatal("public key")
	}
	m := Manifest{Version: "0.5.0", Sha256: hex.EncodeToString(sha256.New().Sum(nil)), Bytes: 512}
	if err := verifyManifest(m); err == nil {
		t.Fatal("accepted unsigned manifest")
	}
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	m.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(private, signedData(m)))
	if err := verifyManifest(m); err == nil {
		t.Fatal("accepted wrong key")
	}
}
func TestInvalidZipNoPointerChange(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "VERSION.txt"), []byte("0.4.0\n"), 0600)
	_ = os.MkdirAll(filepath.Join(dir, "versions", "0.4.0"), 0700)
	_ = os.WriteFile(filepath.Join(dir, "versions", "0.4.0", "Launch.ps1"), []byte("ok"), 0600)
	if v, _ := currentVersion(dir); v != "0.4.0" {
		t.Fatalf("want bootstrap, got %s", v)
	}
	if err := writeCurrentVersion(dir, "0.5.0"); err != nil {
		t.Fatal(err)
	}
	if v, _ := currentVersion(dir); v != "0.4.0" {
		t.Fatal("missing stage selected")
	}
}

func TestRetentionThreePrevious(t *testing.T) {
	root := t.TempDir()
	for _, v := range []string{"0.3.5", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0"} {
		dir := filepath.Join(root, "versions", v)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "Launch.ps1"), []byte("present"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	keep := previousVersions(root, "0.8.0")
	if len(keep) != 3 || keep[0] != "0.7.0" || keep[1] != "0.6.0" || keep[2] != "0.5.0" {
		t.Fatalf("wrong rollback candidates: %v", keep)
	}
	if err := pruneVersions(root, "0.8.0"); err != nil {
		t.Fatal(err)
	}
	for _, v := range []string{"0.8.0", "0.7.0", "0.6.0", "0.5.0"} {
		if _, err := os.Stat(filepath.Join(root, "versions", v)); err != nil {
			t.Fatalf("removed retained %s", v)
		}
	}
	for _, v := range []string{"0.4.0", "0.3.5"} {
		if _, err := os.Stat(filepath.Join(root, "versions", v)); !os.IsNotExist(err) {
			t.Fatalf("did not prune %s", v)
		}
	}
}
func TestSignedZipHashPathUnauthenticated(t *testing.T) {
	m := Manifest{Version: "0.5.0", Sha256: strings.Repeat("0", 64), Bytes: 100}
	if err := verifyManifest(m); err == nil {
		t.Fatal("Unsigned artifact accepted")
	}
}
