from pathlib import Path
p=Path('/mnt/data/actor_launcher')
s=Path('/mnt/data/studio_launcher/launcher/update.go').read_text()
s=s.replace('github.com/Discolter/fundi-voice-studio-desktop/releases','github.com/Discolter/fundi-voice-actor-desktop/releases')
s=s.replace('/studio-update.json','/actor-update.json').replace('/studio-app.zip','/actor-app.zip')
s=s.replace('FundiVoiceStudio-Updater','FundiVoiceActor-Updater').replace('fundi-studio-v1','fundi-actor-v1')
s=s.replace('const maxBundleSize int64 = 40 << 20','const maxBundleSize int64 = 50 << 20')
s=s.replace('const maxUncompressedSize int64 = 60 << 20','const maxUncompressedSize int64 = 100 << 20')
s=s.replace('BRf9Kn1b8MVwv8GhlnPOjCTlWCS5sAIeecGg/vuFrak=','REPLACE_ACTOR_PUBLIC_KEY')
s=s.replace('"Launch.ps1", "LocalServer.cs", "CloudCommon.cs", "web/index.html", "web/app.js", "VERSION.txt"','"Launch.ps1", "Build-Actor.ps1", "Program.cs", "ActorHost.cs", "ActorVacations.cs", "web/index.html", "web/app.js", "VERSION.txt"')
s=s.replace('"1.8.0"','"0.4.0"')
s=s.replace('if _, err := os.Stat(filepath.Join(d, "Launch.ps1")); err == nil {','if _, err := os.Stat(filepath.Join(d, "Launch.ps1")); err == nil {')
# version fallback to bundled path, fail closed when base version missing
start=s.index('\tlegacy := strings.TrimSpace(readSmallFile(filepath.Join(root, "VERSION.txt")))')
end=s.index('\n}',start)
s=s[:start]+'''\tinitial := strings.TrimSpace(readSmallFile(filepath.Join(root, "VERSION.txt")))
    if !semver.MatchString(initial) { initial = "0.4.0" }
    bundled := filepath.Join(root,"versions",initial)
    if _, err := os.Stat(filepath.Join(bundled,"Launch.ps1")); err == nil { return initial,bundled }
    return "", ""
'''+s[end:]
s=s.replace('if _, err := os.Stat(filepath.Join(versionDir, "Launch.ps1")); err == nil {\n\t\treturn writeCurrentVersion(root, m.Version)\n\t}', '''if _, err := os.Stat(filepath.Join(versionDir, "Launch.ps1")); err == nil {
        // Never auto-activate a previously staged version without re-checking its signature.
        // An authenticated manifest authorizes a particular ZIP hash, not arbitrary local files.
        if isPreviouslyVerified(root, m.Version, m.Sha256) {
            return writeCurrentVersion(root,m.Version)
        }
        return errors.New("Предыдущий каталог обновления не имеет подтверждённого хеша")
    }''')
s=s.replace('if err := os.Rename(stage, versionDir); err != nil {\n\t\treturn err\n\t}\n\t// Atomic pointer swap.', '''if err := os.WriteFile(filepath.Join(stage,".verified-sha256"),[]byte(strings.ToLower(m.Sha256)+"\\n"),0600);err!=nil{return err}
    if err := os.Rename(stage, versionDir); err != nil { return err }
    // Atomic pointer swap.''')
s=s.replace('func installDownloaded(root string, m Manifest, client *http.Client) error {','''func isPreviouslyVerified(root, version, hash string) bool {
    got:=strings.TrimSpace(readSmallFile(filepath.Join(root,"versions",version,".verified-sha256")))
    return len(got)==64 && strings.EqualFold(got,hash)
}
func installDownloaded(root string, m Manifest, client *http.Client) error {''')
# compare will reject malformed versions not updated
s += '''
// Keep exactly the current build plus at most three earlier known-good builds.
// Only call after the new Actor process has successfully started (mutex observed).
func installedVersions(root string) []string {
    items,err:=os.ReadDir(filepath.Join(root,"versions"));if err!=nil{return nil}
    var versions []string
    for _,item:=range items {
       if !item.IsDir() || !semver.MatchString(item.Name()) {continue}
       if stat,e:=os.Stat(filepath.Join(root,"versions",item.Name(),"Launch.ps1"));e==nil && stat.Mode().IsRegular(){versions=append(versions,item.Name())}
    }
    sort.Slice(versions,func(i,j int)bool{return compareVersion(versions[i],versions[j])>0})
    return versions
}
func previousVersions(root,current string) []string {
    var out []string
    for _,v:=range installedVersions(root) {
        if compareVersion(v,current)<0 {out=append(out,v)}
        if len(out)==3{break}
    }
    return out
}
func pruneVersions(root,current string) error {
    if !semver.MatchString(current) { return errors.New("Invalid current version") }
    allowed:=map[string]bool{current:true}
    for _,v:=range previousVersions(root,current){allowed[v]=true}
    // Don't traverse arbitrary paths: only scan direct version-name directories.
    for _,v:=range installedVersions(root) {
        if !allowed[v] {
            if err:=os.RemoveAll(filepath.Join(root,"versions",v));err!=nil{return err}
        }
    }
    // Downloaded ZIPs are temporary and should never build up.
    if tmp,err:=os.ReadDir(filepath.Join(root,".updates"));err==nil{
        for _,v:=range tmp {if !v.IsDir()&&strings.HasPrefix(v.Name(),"update-")&&strings.HasSuffix(v.Name(),".zip") { _=os.Remove(filepath.Join(root,".updates",v.Name())) }}
    }
    return nil
}
'''
s=s.replace('"path/filepath"','"path/filepath"\n "sort"')
s=s.replace('strings.TrimSpace(readSmallFile(filepath.Join(root, "bad-version.txt"))) == m.Version','strings.TrimSpace(readSmallFile(filepath.Join(root, "bad-version.txt"))) == m.Version || strings.TrimSpace(readSmallFile(filepath.Join(root, "skip-version.txt"))) == m.Version')
(p/'launcher/update.go').write_text(s)
(p/'go.mod').write_text('module fundivoice/actor-updater\n\ngo 1.23\n')
print('go file created',len(s))
