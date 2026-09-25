@echo off
rem Opintodashboardin asennus Windowsille. Tuplaklikkaa tai aja: setup.bat
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode
goto :run

:nonode
echo.
echo Node.js puuttuu (vaaditaan versio 18 tai uudempi).
where winget >nul 2>nul
if errorlevel 1 goto :manual
choice /C KE /M "Asennetaanko Node.js LTS nyt wingetilla"
if errorlevel 2 goto :manual
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto :manual
echo.
echo Node.js asennettu. Avaa uusi komentoikkuna (tai tuplaklikkaa setup.bat uudelleen),
echo jotta asennus tulee voimaan.
pause
exit /b 0

:manual
echo.
echo Asenna Node.js LTS osoitteesta https://nodejs.org ja aja setup.bat uudelleen.
pause
exit /b 1

:run
node src/setup.js
if errorlevel 1 (
  pause
  exit /b 1
)
choice /C KE /M "Avataanko dashboard nyt"
if errorlevel 2 exit /b 0
node src/server.js
