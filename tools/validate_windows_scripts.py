#!/usr/bin/env python3
"""Guard Actor bootstrap script encoding on Windows PowerShell 5.x.

PowerShell 5.x treats no-BOM UTF-8 script files as the system ANSI codepage.
This script guards against invalid localized literals, the cause of 0.4.0's
UnexpectedToken failure. It uses Python's standard library only.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
script = (root / 'app' / 'Build-Actor.ps1').read_bytes()
assert script.startswith(b'\xef\xbb\xbf'), 'Build-Actor.ps1 must begin with UTF-8 BOM'
script_text = script[3:].decode('ascii')
assert '/codepage:65001' in script_text, 'C# source files must be compiled as UTF-8'
assert 'ActorVacations.cs' in script_text, 'New Actor feature file must compile'
assert 'FundiVoiceActor.App.exe' in script_text, 'App binary must be staged for launcher'
bootstrap = (root / 'Build-Installer.ps1').read_bytes()
assert bootstrap.startswith(b'\xef\xbb\xbf'), 'Build-Installer.ps1 must have UTF-8 BOM'
shortcuts = (root / 'installer' / 'main.go').read_text(encoding='utf8')
assert 'tmp.WriteString("\\ufeff" + script)' in shortcuts, 'Shortcut script must have UTF-8 BOM'
print('PowerShell 5 encoding and Actor build script checks passed')
