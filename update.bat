@echo off
rem Updates Box Dispatch to the latest version from GitHub, then re-installs the app's packages,
rem rebuilds the website and fetches the latest Android app. Your data (backend\data.db) is kept.
setlocal
cd /d "%~dp0"

netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
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
git pull --ff-only || goto :error
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" -NoSystemChanges || goto :error
echo.
echo Update finished. Start Box Dispatch with the desktop shortcut.
pause
exit /b 0

:error
echo.
echo UPDATE FAILED. See the messages above. If it says Python or Node.js is missing or too old, run setup.bat.
pause
exit /b 1
