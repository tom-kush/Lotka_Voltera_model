# Lotka-Volterra Simulation Runner
$ErrorActionPreference = "Stop"

Write-Host "Starting Lotka-Volterra Ecosystem..." -ForegroundColor Cyan

# Start Backend
Write-Host "Cleaning up old processes on ports 8000 and 5173..." -ForegroundColor Gray
try {
    Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
} catch {}

Write-Host "Launching Python Backend (FastAPI)..." -ForegroundColor Yellow
# Removed -WindowStyle Hidden so you can see the version print
$BackendProcess = Start-Process powershell -ArgumentList "-NoProfile", "-Command", "cd backend; .\venv\Scripts\python.exe main.py" -PassThru

# Start Frontend
Write-Host "Launching React Frontend (Vite)..." -ForegroundColor Yellow
# We use -NoExit so you can see if the frontend fails to start
$FrontendProcess = Start-Process powershell -ArgumentList "-NoProfile", "-Command", "cd frontend; npm.cmd run dev" -PassThru

# Wait a moment for servers to spin up
Start-Sleep -Seconds 2

Write-Host "Opening simulation in browser..." -ForegroundColor Green
Start-Process "http://localhost:5173"

Write-Host "Simulation is running!" -ForegroundColor Cyan
Write-Host "------------------------------------------------" -ForegroundColor White
Write-Host "Backend: http://localhost:8000" -ForegroundColor Gray
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Gray
Write-Host "------------------------------------------------" -ForegroundColor White
Write-Host "Press any key to stop both servers and exit..." -ForegroundColor Gray

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Cleanup
Write-Host "Stopping servers..." -ForegroundColor Red
Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $FrontendProcess.Id -Force -ErrorAction SilentlyContinue
