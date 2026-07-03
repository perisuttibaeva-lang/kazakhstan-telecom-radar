@echo off
setlocal
cd /d "%~dp0"
start "" "http://localhost:3001"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-radar.ps1" -Port 3001
