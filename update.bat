@echo off
rem Updates Box Dispatch to the latest version from GitHub, then re-runs the setup (packages, website,
rem Android app, firewall rule). Your data (backend\data.db) is kept. Needs administrator rights.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
    echo Asking Windows for administrator rights...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" || (
        echo Updating needs administrator rights. Right-click update.bat and choose "Run as administrator".
        pause
    )
    exit /b
)

netstat -ano | findstr /r /c:":8015 .*LISTENING" >nul
if not errorlevel 1 (
    echo Box Dispatch is running. Close its windows ^(the server and the print agent^) and run update.bat again.
    pause
    exit /b 1
)
where git >nul 2>&1
if errorlevel 1 (
    echo Git is not installed. Install it from https://git-scm.com/download/win and run update.bat again.
    pause
    exit /b 1
)

echo Getting the latest version...
rem git pull may replace this file while it runs. Windows reads a whole ( ) block before running it,
rem so everything from here on is one block.
(
    git -c safe.directory=* pull --ff-only
    if errorlevel 1 (
        echo.
        echo UPDATE FAILED: could not get the latest version. See the message above.
        pause
        exit /b 1
    )
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
    if errorlevel 1 (
        echo.
        echo UPDATE FAILED. See the message above ^(also saved in setup-log.txt^).
        pause
        exit /b 1
    )
    echo.
    echo Update finished. Start Box Dispatch with the desktop shortcut.
    pause
    exit /b 0
)
