@echo off
setlocal
cd /d "%~dp0"
node server.mjs --workshop --open
if errorlevel 1 pause
