@echo off
setlocal
cd /d "%~dp0"

rem ---- Backend: create virtualenv and install packages on first run ----
if not exist "backend\.venv\Scripts\python.exe" (
    echo Setting up Python environment...
    python -m venv "backend\.venv" || goto :error
    "backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt" || goto :error
)

rem ---- Frontend: install packages on first run, then build ----
if not exist "frontend\node_modules" (
    echo Installing frontend packages...
    pushd frontend
    call npm install || (popd & goto :error)
    popd
)
echo Building frontend...
pushd frontend
call npm run build || (popd & goto :error)
popd

rem ---- Start server and open the browser once it is up ----
echo.
echo Starting Box Dispatch at http://localhost:8000  (press Ctrl+C to stop)
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:8000"
cd backend
rem The print agent prints jobs on this PC's default printer. It runs in its own
rem minimized window; close that window to stop printing.
start "Box Dispatch - print agent" /min ".venv\Scripts\python.exe" print_agent.py
".venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
goto :eof

:error
echo.
echo Startup failed. See the messages above.
pause
exit /b 1
