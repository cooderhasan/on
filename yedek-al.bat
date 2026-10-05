@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Yerel veritabaninin SQL yedegini yedekler\ klasorune alir (git'e gitmez).
if not exist yedekler mkdir yedekler
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set ZAMAN=%%i
docker compose exec -T postgres pg_dump -U muhasebe --clean --if-exists muhasebe > "yedekler\muhasebe-%ZAMAN%.sql"
if errorlevel 1 (
  echo [HATA] Yedek alinamadi. Docker Desktop calisiyor mu?
  pause
  exit /b 1
)
echo Yedek alindi: yedekler\muhasebe-%ZAMAN%.sql
echo Geri yuklemek icin: docker compose exec -T postgres psql -U muhasebe muhasebe ^< yedekler\DOSYA.sql
pause
