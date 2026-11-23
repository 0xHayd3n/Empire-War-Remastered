@echo off
setlocal
cd /d "%~dp0"
node server.mjs --universal --open
if errorlevel 1 pause
