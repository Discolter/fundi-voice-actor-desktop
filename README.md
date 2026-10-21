# Fundi Voice Actor Launcher

A **separate update channel for Actor** (`Discolter/fundi-voice-actor-desktop`), not Studio and not the private Cloud project.

## After installing

- Open **Fundi Voice Actor** as usual. The launcher checks the public GitHub Releases URL and opens the installed Actor.
- A new release is accepted only after **Ed25519 signature** verification plus SHA-256 and size verification. Secrets stay outside the launcher.
- Releases are staged into `versions/<version>` and switched atomically. Existing account info, tokens and preferences in `%LOCALAPPDATA%\FundiVoiceActor` are never overwritten.
- An offline launch keeps working; a failed upgrade falls back to the last working version.
- The launcher retains **current + at most 3 previous verified installations**; it deletes older app binaries only **after the new Actor mutex appears**, proving the program actually started.
- To roll back, close Actor from the Windows tray and choose **Start Menu → Fundi Voice Actor → Fundi Voice Actor - Откат версии**. Choose among the last 3 previous versions.
- Old versions on GitHub Releases can remain available for historical reference; the launcher only retains up to three previous locally.

## One-time publication setup

1. Create **Public** GitHub repository `Discolter/fundi-voice-actor-desktop` (release-only channel; sources are public if pushed here). Do not reuse `fundi-voice-cloud` (private).
2. In **Settings → Secrets and variables → Actions**, add secret **`ACTOR_SIGNING_SEED_B64`** using the 44-character base64 value from the separate private seed text file. Keep that file offline in a password manager.
3. Upload all files from the **launcher source ZIP** to the root of this new repository. **Never upload the private seed file**. Configure the secret first so the initial main push can publish a release successfully.
4. Workflow `.github/workflows/publish-actor.yml` compiles the real Windows app, checks Go updater tests, creates `actor-app.zip`, signs `actor-update.json`, and publishes a new `v<version>` release. The launcher reads `/releases/latest/download/actor-update.json`.
5. For each later release, update `app/` source files and **increment `app/VERSION.txt`**. Never replace existing signed release assets in place.
6. Before distributing to the acting team, test on one Windows 10/11 computer with an existing 0.3.5/0.4.1 install; verify login, recordings, vacation, rollback and offline launch.

### Installation and migration

The per-user bootstrap installs to `%LOCALAPPDATA%\Programs\Fundi Voice Actor`, replacing the **old program launcher** at `FundiVoiceActor.exe`, not user data. It first compiles bundled 0.4.1 with the installed .NET Framework compiler **before changing anything**. If that fails, the existing Actor app remains untouched. If migrating from a pre-launcher version below 0.4.1, that old release is copied to `versions/<old version>` for rollback.

### Build

On Windows with Go 1.23+, Python 3, and .NET Framework 4.8: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build-Installer.ps1`.
On Linux: `go test ./launcher ./tools/...`; `GOOS=windows GOARCH=amd64 go build ./launcher` verifies cross-compilation, but **does not** verify that C# compiles or Actor launches on real Windows.

This is a source + bootstrap package until the public release repository and signing secret are configured. Automatic updates cannot work before that connection.

## Installer 0.4.1 hotfix (Windows PowerShell 5)

The previous 0.4.0 installer failed on some non-UTF-8 Windows locales because PowerShell 5 treated UTF-8 source without BOM as ANSI. Build-Actor.ps1 now uses ASCII-only script text plus UTF-8 BOM, and invokes csc.exe with `/codepage:65001` for localized C# sources. Setup writes detailed compilation diagnostics to `%LOCALAPPDATA%\FundiVoiceActor\actor-installer-build.log` on failure. Shortcut-generation scripts are written with UTF-8 BOM. The existing Actor is not replaced until native compilation succeeds.
