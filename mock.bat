@echo off
REM Boots the backend + frontend in the background, waits a few seconds, then
REM runs the UDP mock sender in this window. On exit it kills exactly the two
REM spawned process trees by PID (never a blanket "taskkill /IM node.exe").
REM
REM The backend runs with `npm start` (not `npm run dev`) so writing score files
REM can't trigger a --watch restart mid-run.
REM
REM Requires backend\.env (SPREADSHEET_ID) + backend\keys.json — point them at a
REM throwaway sheet, since final scores are appended for real.
REM
REM Note: assumes the repo path has no spaces (it doesn't here). For the nicer,
REM combined-logs experience prefer mock.ps1.

setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "LOGDIR=%ROOT%udp-mock-sender\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo Starting backend (logs: %LOGDIR%\backend.log)...
set "BACKEND_PID="
for /f "tokens=2 delims==" %%A in ('wmic process call create "cmd /c npm.cmd start --prefix %ROOT%backend > %LOGDIR%\backend.log 2>&1" ^| find "ProcessId"') do set "BACKEND_PID=%%A"
set "BACKEND_PID=%BACKEND_PID:;=%"
set "BACKEND_PID=%BACKEND_PID: =%"

echo Starting frontend (logs: %LOGDIR%\frontend.log)...
set "FRONTEND_PID="
for /f "tokens=2 delims==" %%A in ('wmic process call create "cmd /c npm.cmd run dev --prefix %ROOT%frontend > %LOGDIR%\frontend.log 2>&1" ^| find "ProcessId"') do set "FRONTEND_PID=%%A"
set "FRONTEND_PID=%FRONTEND_PID:;=%"
set "FRONTEND_PID=%FRONTEND_PID: =%"

echo Waiting 6s for backend + frontend to start...
timeout /t 6 /nobreak >nul

echo Running mock sender...
call npm.cmd start --prefix "%ROOT%udp-mock-sender"

echo.
echo Tester finished. Final scores flush to the sheet within ~5s.
echo Press any key to stop backend + frontend...
pause >nul

if defined BACKEND_PID (
  echo Stopping backend (PID %BACKEND_PID%)...
  taskkill /PID %BACKEND_PID% /T /F >nul 2>&1
)
if defined FRONTEND_PID (
  echo Stopping frontend (PID %FRONTEND_PID%)...
  taskkill /PID %FRONTEND_PID% /T /F >nul 2>&1
)
endlocal
