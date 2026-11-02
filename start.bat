@echo off
rem Double-click to start Nexa. Works offline once setup.ps1 has run.
cd /d "%~dp0"
title Nexa

if not exist "server.py" (
  echo Nexa's files aren't here. Unzip Nexa.zip first ^(right-click it, Extract All^),
  echo then double-click start.bat inside the extracted folder.
  pause & exit /b 1
)

rem Setup runs until it finishes once, so an interrupted install picks up where it stopped.
rem (A setup finished before the rename to Nexa left an "orion-ready" mark.)
if exist ".venv\orion-ready" ren ".venv\orion-ready" nexa-ready
if not exist ".venv\nexa-ready" goto setup
if not exist ".venv\owner-voice-ready" goto setup
goto launch

:setup
  echo Setting up Nexa. This needs internet one time only and takes a while.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
  if errorlevel 1 ( pause & exit /b 1 )

:launch

rem Start Nexa without a console window. She starts Ollama if needed, brings her window back if
rem she's already running, and saves what she hears to logs\nexa.log. Quit her from Settings.
start "" ".venv\Scripts\pythonw.exe" "%~dp0server.py" --launch
