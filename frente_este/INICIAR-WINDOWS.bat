@echo off
chcp 65001 >nul
title FRENTE ESTE - Servidor
cd /d "%~dp0servidor"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js no esta instalado. Instalandolo con winget...
  echo.
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)

where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%PATH%;%ProgramFiles%\nodejs"
  ) else (
    echo.
    echo  No se pudo instalar Node.js automaticamente.
    echo  Se abrira la pagina de descarga: instala la version LTS y vuelve a abrir este archivo.
    start "" https://nodejs.org/es/download
    pause
    exit /b 1
  )
)

node servidor.js 8080 --abrir
echo.
pause
