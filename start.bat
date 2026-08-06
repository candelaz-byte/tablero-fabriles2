@echo off
set PATH=C:\Program Files\nodejs;%PATH%
echo === TABLERO FABRILES ===
echo.
echo Instalando dependencias si es necesario...
if not exist node_modules (
  npm install
)
echo.
echo Iniciando servidor en http://localhost:3002
echo Schema SQL: http://localhost:3002/api/schema
echo.
node server.js
pause
