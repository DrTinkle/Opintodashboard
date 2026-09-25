@echo off
rem Opintodashboardin kaynnistys Windowsille. Tuplaklikkaa tai kayta
rem tyopoydan pikakuvaketta. Dashboard on kaynnissa niin kauan kuin tama
rem ikkuna on auki. Jos dashboard on jo kaynnissa, avataan vain selain.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Opintodashboard

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js puuttuu. Aja ensin setup.bat.
  pause
  exit /b 1
)

if not exist "data\data.json" (
  node src/setup.js
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Selain avautuu automaattisesti.
echo Pida tama ikkuna auki dashboardin kayton ajan. Sulje ikkuna lopettaaksesi.
echo.
node src/server.js
if errorlevel 1 pause
