#!/usr/bin/env python3
"""Verify every desktop stylesheet exists in the local HTTP server allowlist."""
import re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
html=(root/"app/web/index.html").read_text(encoding="utf-8-sig")
host=(root/"app/ActorHost.cs").read_text(encoding="utf-8-sig")
css=(root/"app/web/animated-themes.css").read_text(encoding="utf-8-sig")
core=(root/"app/web/core.js").read_text(encoding="utf-8-sig")
sheets=re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"',html)
assert sheets,"HTML did not list stylesheets"
for file in sheets:
    assert "/"+file in host, "The local host would return 404 for "+file
assert "animated-themes.css" in sheets and "text/css" in host
for theme in ("living-sunset","living-aurora","living-ocean","living-plum"):
    assert 'data-theme="'+theme+'"' in css,theme
    assert core.count("['"+theme+"',")==1,"Duplicate/missing theme "+theme
assert "animation:fundivoice-gradient-drift 22s" in css
assert "@keyframes fundivoice-gradient-drift" in css
assert 'body[data-motion="off"]' in css
assert "prefers-reduced-motion" in css
print("PASS: CSS allowlist, four animated themes, reduced-motion support")
