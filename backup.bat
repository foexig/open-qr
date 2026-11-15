@echo off
setlocal
cd /d "%~dp0"
if not exist backups mkdir backups
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set TS=%%t
set FILE=open-qr-%TS%.dump
docker compose exec -T db pg_dump -U openqr -d openqr -Fc -f /tmp/%FILE% || exit /b 1
docker compose cp db:/tmp/%FILE% backups\%FILE% || exit /b 1
docker compose exec -T db rm -f /tmp/%FILE%
echo Backup written to backups\%FILE%
endlocal
