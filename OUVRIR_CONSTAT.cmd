@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:8765/' -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Process -FilePath 'node' -ArgumentList ([char]34 + (Join-Path (Get-Location) 'server.cjs') + [char]34) -WindowStyle Hidden; Start-Sleep -Seconds 2 }; Start-Process 'http://127.0.0.1:8765/'"
