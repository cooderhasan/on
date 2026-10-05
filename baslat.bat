@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Ön Muhasebe
docker info >nul 2>&1
if errorlevel 1 (
  echo [HATA] Docker Desktop calismiyor. Acin, "Engine running" yazana kadar bekleyin, sonra tekrar calistirin.
  pause
  exit /b 1
)
echo Veritabani baslatiliyor...
docker compose up -d postgres
if not exist node_modules (
  echo Paketler yukleniyor (ilk calistirma, birkac dakika)...
  call npm install
)
echo Tablolar guncelleniyor...
call npx prisma migrate deploy
echo.
echo Uygulama baslatiliyor. Tarayici birkac saniye icinde acilacak: http://localhost:3000
echo Kapatmak icin bu pencerede Ctrl+C yapin.
echo.
start "" cmd /c "timeout /t 10 /nobreak >nul & start http://localhost:3000"
call npm run dev
pause
