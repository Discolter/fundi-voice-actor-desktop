$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot
$exe=Join-Path $PSScriptRoot 'FundiVoiceActor.App.exe'
if (!(Test-Path -LiteralPath $exe)) {
  & (Join-Path $PSScriptRoot 'Build-Actor.ps1')
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $exe)) {throw 'Actor executable was not built.'}
}
# Start the host outside PowerShell's lifetime. Login and user files remain in LOCALAPPDATA\FundiVoiceActor.
Start-Process -FilePath $exe -WorkingDirectory $PSScriptRoot
