# Execute the compiled production account/cache code without opening a window.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$assembly = [Reflection.Assembly]::LoadFrom((Join-Path $root 'app/FundiVoiceActor.App.exe'))
$type = $assembly.GetType('FundiVoice.ActorCloud', $true)
$flags = [Reflection.BindingFlags]::Instance -bor [Reflection.BindingFlags]::NonPublic
$directory = Join-Path ([IO.Path]::GetTempPath()) ('fv-cache-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory) | Out-Null
$actor = [Activator]::CreateInstance($type, [object[]]@($directory))
$type.GetField('timer', $flags).GetValue($actor).Dispose()
function Set-Field($name, $value) { $type.GetField($name, $flags).SetValue($actor, $value) }
function Seed-Account {
    $session = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $session.Add('refreshToken', 'test-session')
    $session.Add('username', 'previous_actor')
    Set-Field 'session' $session
    Set-Field 'recordingFiles' ([object[]]@('previous_actor_recording.wav'))
    Set-Field 'usedBytes' ([long]12345)
    Set-Field 'fileApiAvailable' $true
    Set-Field 'fileError' 'previous_actor_error'
    Set-Field 'vacationApiAvailable' $true
    Set-Field 'vacationData' ([pscustomobject]@{current='previous_actor_vacation'})
    $jobs = $type.GetField('transfers', $flags).GetValue($actor)
    $jobType = $assembly.GetType('FundiVoice.Desktop.TransferJob', $true)
    $job = [Activator]::CreateInstance($jobType, [object[]]@('upload','previous_actor_recording.wav',[long]1,'old_role'))
    $job.Finish()
    $jobs.GetType().GetField('current', $flags).SetValue($jobs, $job)
}
function Assert-Cleared($status, $name) {
    if (@($status.files).Length -ne 0 -or $status.usedBytes -ne 0 -or $status.fileApiAvailable -or
        $status.fileError -ne '' -or $null -ne $status.transfer -or $status.vacationApiAvailable -or
        $null -ne $status.vacation.current) { throw "Private account cache survived $name" }
    Write-Host "PASS: $name clears previous files, transfer details and vacation"
}
try {
    Seed-Account
    Assert-Cleared ($actor.Logout()) 'logout'
    Seed-Account
    $type.GetMethod('ClearAccountCache', $flags).Invoke($actor, @()) | Out-Null
    Assert-Cleared ($actor.Status()) 'account switch'
    if (-not $actor.Status().authenticated) { throw 'Cache cleanup unexpectedly revoked the new session' }
    Write-Host 'PASS: cache cleanup preserves the newly authenticated account'
} finally {
    $actor.Dispose()
    Remove-Item -LiteralPath $directory -Force -Recurse
}
