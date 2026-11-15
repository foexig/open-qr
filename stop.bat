@echo off
cd /d "%~dp0"
docker compose down || exit /b 1
echo open-qr stopped. Your data is kept in the 'db-data' volume.
