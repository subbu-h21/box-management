@echo off
rem Box Dispatch setup for the main PC (Windows 10/11, 64-bit). Safe to run again.
rem Installs Python and Node.js if needed, the app's packages, the Android app, a firewall rule
rem and a desktop shortcut. Details: scripts\setup.ps1. A log is written to setup-log.txt.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo Asking Windows for administrator rights...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" || (
        echo Setup needs administrator rights. Right-click setup.bat and choose "Run as administrator".
        pause
    )
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
if errorlevel 1 (
    echo.
    echo SETUP FAILED. See the message above ^(also saved in setup-log.txt^), fix it and run setup.bat again.
    pause
    exit /b 1
)
echo.
echo Setup finished.
pause
