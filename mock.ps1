# Boots the backend + frontend, waits a few seconds, then runs the UDP mock
# sender against them — all in this one window (combined logs). Ctrl+C or
# pressing Enter tears everything down cleanly (child node trees are killed by
# PID, never a blanket "kill all node").
#
# The backend runs with `npm start` (not `npm run dev`) so writing score files
# can't trigger a --watch restart mid-run.
#
# Requires backend\.env (SPREADSHEET_ID) + backend\keys.json — point them at a
# throwaway sheet, since final scores are appended for real.
#
# Run:  powershell -ExecutionPolicy Bypass -File .\mock.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$backend = $null
$frontend = $null

try {
    Write-Host "Starting backend (npm start)..."
    $backend = Start-Process -FilePath "npm.cmd" -ArgumentList "start" `
        -WorkingDirectory (Join-Path $root "backend") -NoNewWindow -PassThru

    Write-Host "Starting frontend (npm run dev)..."
    $frontend = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" `
        -WorkingDirectory (Join-Path $root "frontend") -NoNewWindow -PassThru

    Write-Host "Waiting 6s for backend + frontend to start..."
    Start-Sleep -Seconds 6

    Write-Host "Running mock sender..."
    Push-Location (Join-Path $root "udp-mock-sender")
    try {
        & npm.cmd start
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "Tester finished. Final scores flush to the sheet within ~5s."
    Write-Host "Press Enter to stop backend + frontend..."
    Read-Host | Out-Null
}
finally {
    Write-Host "Stopping backend + frontend..."
    if ($backend) { taskkill /PID $backend.Id /T /F 2>$null | Out-Null }
    if ($frontend) { taskkill /PID $frontend.Id /T /F 2>$null | Out-Null }
}
