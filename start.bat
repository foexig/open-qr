@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where docker >nul 2>&1 || (echo Error: Docker is not installed. See https://docs.docker.com/get-docker/ & exit /b 1)
docker info >nul 2>&1 || (echo Error: Docker is not running. Start Docker Desktop and try again. & exit /b 1)
docker compose version >nul 2>&1 || (echo Error: Docker Compose v2 is required. & exit /b 1)

if not exist .env (
  echo Creating .env from .env.example with a random database password...
  powershell -NoProfile -Command "$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $pw = -join ($b | ForEach-Object { $_.ToString('x2') }); (Get-Content .env.example) -replace '^POSTGRES_PASSWORD=.*', ('POSTGRES_PASSWORD=' + $pw) | Set-Content -Encoding ascii .env" || (echo Error: could not create .env & exit /b 1)
)

set PORT=8000
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if "%%a"=="APP_PORT" set PORT=%%b

echo Building and starting containers...
docker compose up -d --build || exit /b 1

for /f %%i in ('docker compose ps -q app') do set CID=%%i
set /a TRIES=0
<nul set /p "=Waiting for open-qr to become healthy"
:wait
for /f %%s in ('docker inspect -f "{{.State.Health.Status}}" !CID!') do set STATE=%%s
if "!STATE!"=="healthy" goto ready
if "!STATE!"=="unhealthy" goto failed
set /a TRIES+=1
if !TRIES! geq 90 goto failed
<nul set /p "=."
timeout /t 2 /nobreak >nul
goto wait

:failed
echo.
echo open-qr did not start (state: !STATE!). Last log lines:
docker compose logs --tail 40 app
exit /b 1

:ready
echo.
echo.
echo open-qr is running:  http://localhost:!PORT!
docker compose exec -T app python -m app.cli setup-info
echo.
echo Stop with stop.bat   Logs: docker compose logs -f app
endlocal
