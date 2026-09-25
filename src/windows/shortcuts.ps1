# shortcuts.ps1
#
# Luo tyopoydalle pikakuvakkeet Opintodashboardin kaynnistykseen
# (kaynnista.bat) ja paivitykseen (paivita.bat) omilla kuvakkeillaan.
# setup.bat kysyy taman ajamisesta. Kasin:
#   powershell -NoProfile -ExecutionPolicy Bypass -File src\windows\shortcuts.ps1
#
# Tiedosto on ASCII-muodossa, koska Windows PowerShell 5 lukee BOM:ittoman
# tiedoston ANSI-merkistona. Siksi a-umlaut tehdaan merkkikoodista.

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$ae = [char]0x00E4
$shell = New-Object -ComObject WScript.Shell

function New-DashboardShortcut($name, $target, $icon, $description) {
  $lnk = $shell.CreateShortcut((Join-Path $desktop ($name + '.lnk')))
  $lnk.TargetPath = Join-Path $root $target
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = (Join-Path $root $icon) + ',0'
  $lnk.Description = $description
  $lnk.Save()
}

New-DashboardShortcut 'Opintodashboard' 'kaynnista.bat' 'public\icons\dashboard.ico' ("K$($ae)ynnist$($ae) Opintodashboard")
New-DashboardShortcut ("P$($ae)ivit$($ae) Opintodashboard") 'paivita.bat' 'public\icons\paivita.ico' ("P$($ae)ivit$($ae) Opintodashboard uusimpaan versioon")
Write-Host "Pikakuvakkeet luotu ty$([char]0x00F6)p$($ae)yd$($ae)lle: Opintodashboard ja P$($ae)ivit$($ae) Opintodashboard."
