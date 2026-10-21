package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
)

func main() {
	if len(os.Args) != 4 {
		panic("sign-release <version> <zip path> <output json path>")
	}
	version := os.Args[1]
	if !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(version) {
		panic("invalid version")
	}
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("ACTOR_SIGNING_SEED_B64")))
	if err != nil || len(seed) != ed25519.SeedSize {
		panic("Configure ACTOR_SIGNING_SEED_B64 (base64 Ed25519 seed) as GitHub secret")
	}
	raw, err := os.ReadFile(os.Args[2])
	if err != nil {
		panic(err)
	}
	h := sha256.Sum256(raw)
	sum := hex.EncodeToString(h[:])
	content := []byte("fundi-actor-v1\n" + version + "\n" + sum + "\n")
	sig := ed25519.Sign(ed25519.NewKeyFromSeed(seed), content)
	manifest := struct {
		Version   string `json:"version"`
		Sha256    string `json:"sha256"`
		Signature string `json:"signature"`
		Bytes     int    `json:"bytes"`
	}{version, sum, base64.StdEncoding.EncodeToString(sig), len(raw)}
	b, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Args[3], append(b, '\n'), 0644); err != nil {
		panic(err)
	}
	fmt.Printf("Signed %s (%d bytes) SHA-256 %s\n", version, len(raw), sum)
}
