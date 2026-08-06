@echo off
set PATH=C:\Program Files\nodejs;%PATH%
set FIREBASE=node "C:\Users\Usuario\AppData\Roaming\npm\node_modules\firebase-tools\lib\bin\firebase.js"

echo === DEPLOY TABLERO FABRILES ===
echo.

echo [1/3] Configurando SQL_PASS...
%FIREBASE% functions:secrets:set SQL_PASS

echo.
echo [2/3] Instalando dependencias de functions...
cd functions
npm install
cd ..

echo.
echo [3/3] Desplegando a Firebase...
%FIREBASE% deploy --only hosting,functions

echo.
echo === DEPLOY COMPLETADO ===
pause
