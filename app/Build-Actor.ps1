# Windows PowerShell 5 compatible, encoding-safe Actor build script.
# Keep all parser-visible literals ASCII; compiler reads C# source as UTF-8.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath $PSScriptRoot

$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'VERSION.txt') -TotalCount 1).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid Actor VERSION.txt' }

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw 'Microsoft .NET Framework 4.8 C# compiler not found. Install or enable .NET Framework 4.8.'
}

$sourceNames = @(
    'Program.cs', 'ActorHost.cs', 'ActorTray.cs', 'ActorDiagnostics.cs',
    'ActorCloud.cs', 'ActorVacations.cs', 'ActorFiles.cs',
    'FileTransfers.cs', 'CloudCommon.cs', 'ReviewMailbox.cs', 'UpdateNotice.cs'
)
$sourceFiles = @($sourceNames | ForEach-Object { Join-Path $PSScriptRoot $_ })
foreach ($sourceFile in $sourceFiles) {
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Missing Actor source file: $sourceFile"
    }
}

$output = Join-Path $PSScriptRoot 'FundiVoiceActor.App.exe'
$compilerArgs = @(
    '/nologo', '/noconfig', '/langversion:5', '/codepage:65001',
    '/target:winexe', '/platform:anycpu', '/optimize+', '/warn:4',
    '/warnaserror+', ('/out:' + $output),
    ('/win32manifest:' + (Join-Path $PSScriptRoot 'Actor.manifest')),
    ('/win32icon:' + (Join-Path $PSScriptRoot 'web\favicon.ico')),
    '/reference:System.dll,System.Core.dll,System.Security.dll,System.Web.Extensions.dll,System.Windows.Forms.dll,System.Drawing.dll'
)
& $compiler @compilerArgs @sourceFiles
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output -PathType Leaf)) {
    throw "Actor C# compilation failed with exit code $LASTEXITCODE."
}
Write-Host "Actor $version compiled successfully"
