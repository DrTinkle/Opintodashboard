@echo off
rem Opintodashboardin paivitys uusimpaan versioon. Tuplaklikkaa tai kayta
rem tyopoydan pikakuvaketta. Omat asetukset (.env) ja tiedot (data/)
rem sailyvat, koska ne eivat ole GitHubissa.
rem
rem Git-kloonissa ajetaan git pull. Zip-tiedostona ladatussa kansiossa
rem ladataan uusin zip GitHubista ja kopioidaan sen tiedostot kansion paalle.
rem
rem Paivitys voi korvata myos taman tiedoston, joten skripti ajaa itsensa
rem ensin kopiona TEMP-kansiosta.
setlocal
chcp 65001 >nul

if /i not "%~1"=="--kopio" (
  copy /y "%~f0" "%TEMP%\opintodashboard_paivita.bat" >nul
  "%TEMP%\opintodashboard_paivita.bat" --kopio "%~dp0"
)

set "DIR=%~2"
cd /d "%DIR%"
title Opintodashboardin paivitys

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js puuttuu. Aja ensin setup.bat.
  pause
  exit /b 1
)

rem Kaynnissa oleva dashboard pitaa sulkea ensin: paivitys korvaa
rem kaynnista.bat:n, jota sen ikkuna viela ajaa.
:checkrunning
curl -s -o nul -m 2 http://127.0.0.1:8080/ >nul 2>nul
if errorlevel 1 goto :notrunning
echo Dashboard on kaynnissa. Sulje sen ikkuna ennen paivitysta.
choice /C KE /M "Suljitko dashboardin ikkunan (E peruu paivityksen)"
if errorlevel 2 exit /b 1
goto :checkrunning
:notrunning

if not exist ".git" goto :zip
where git >nul 2>nul
if errorlevel 1 goto :zip

echo Haetaan uusin versio GitHubista (git pull)...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Paivitys epaonnistui. Jos olet muokannut ohjelman tiedostoja itse,
  echo git ei voi yhdistaa muutoksia automaattisesti. Katso: git status
  pause
  exit /b 1
)
goto :done

:zip
set "REPO_ZIP=https://github.com/DrTinkle/Opintodashboard/archive/refs/heads/main.zip"
set "UPDDIR=%TEMP%\opintodashboard_paivitys"
echo Ladataan uusin versio GitHubista...
if exist "%UPDDIR%" rmdir /s /q "%UPDDIR%"
mkdir "%UPDDIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:REPO_ZIP -OutFile (Join-Path $env:UPDDIR 'paivitys.zip'); Expand-Archive -Path (Join-Path $env:UPDDIR 'paivitys.zip') -DestinationPath $env:UPDDIR -Force"
if errorlevel 1 (
  echo.
  echo Lataus epaonnistui. Tarkista verkkoyhteys, tai lataa zip itse:
  echo https://github.com/DrTinkle/Opintodashboard  ^(Code - Download ZIP^)
  echo ja pura se taman kansion paalle.
  pause
  exit /b 1
)
robocopy "%UPDDIR%\Opintodashboard-main" "%DIR%." /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo.
  echo Tiedostojen kopiointi epaonnistui. Sulje dashboard ja yrita uudelleen.
  pause
  exit /b 1
)
rmdir /s /q "%UPDDIR%"

:done
echo.
node src/setup.js
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Paivitys valmis. Jos dashboard oli auki, sulje sen ikkuna ja kaynnista
echo se uudelleen, jotta uusi versio tulee kayttoon.
echo.
choice /C KE /M "Kaynnistetaanko dashboard nyt"
if errorlevel 2 exit /b 0
call "%DIR%kaynnista.bat"
exit /b 0
