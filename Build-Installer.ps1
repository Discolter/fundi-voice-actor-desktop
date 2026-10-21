# Build Actor Launcher bootstrap installer. Windows 10/11, Go 1.23+, .NET Framework 4.8.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {throw 'Для сборки нужен Go 1.23+'}
& go test ./launcher ./tools/...
if ($LASTEXITCODE -ne 0){throw 'Actor launcher unit tests failed'}
& py -3 .\tools\validate_windows_scripts.py
if ($LASTEXITCODE -ne 0){throw 'Windows PowerShell encoding checks failed'}
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\app\Build-Actor.ps1
if ($LASTEXITCODE -ne 0){throw 'Actor C# build failed'}
$version=(Get-Content .\app\VERSION.txt -TotalCount 1).Trim()
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid version'}
New-Item -ItemType Directory -Force -Path .\package\versions\$version | Out-Null
New-Item -ItemType Directory -Force -Path .\dist | Out-Null
& go build -trimpath -ldflags '-s -w -H=windowsgui' -o .\package\FundiVoiceActor.exe ./launcher
if($LASTEXITCODE -ne 0){throw 'Actor launcher compile failed'}
& py -3 .\Embed-Icon.py .\package\FundiVoiceActor.exe .\app\web\favicon.ico
if($LASTEXITCODE -ne 0){throw 'Could not embed launcher icon'}
& go build -trimpath -ldflags '-s -w -H=windowsgui' -o .\package\Uninstall.exe ./uninstaller
if($LASTEXITCODE -ne 0){throw 'Actor uninstaller compile failed'}
& py -3 .\Embed-Icon.py .\package\Uninstall.exe .\app\web\favicon.ico
if($LASTEXITCODE -ne 0){throw 'Could not embed uninstaller icon'}
Copy-Item -Path .\app\* -Destination .\package\versions\$version -Recurse -Force
Copy-Item -Path .\app\web\favicon.ico -Destination .\package\favicon.ico -Force
Set-Content -Path .\package\VERSION.txt -Value $version
Set-Content -Path .\package\current-version.txt -Value $version
if(Test-Path .\installer\payload.zip){Remove-Item .\installer\payload.zip -Force}
Compress-Archive -Path .\package\* -DestinationPath .\installer\payload.zip -CompressionLevel Optimal
$output=".\dist\FundiVoiceActor-Launcher-Setup-$version.exe"
& go build -trimpath -ldflags "-s -w -H=windowsgui -X main.version=$version" -o $output ./installer
if($LASTEXITCODE -ne 0){throw 'Actor bootstrap installer compile failed'}
& py -3 .\Embed-Icon.py $output .\app\web\favicon.ico
if($LASTEXITCODE -ne 0){throw 'Could not embed setup icon'}
Write-Host "Ready: $output" -ForegroundColor Green
