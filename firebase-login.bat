@echo off
set PATH=C:\Program Files\nodejs;%PATH%
echo Iniciando login de Firebase...
node "C:\Users\Usuario\AppData\Roaming\npm\node_modules\firebase-tools\lib\bin\firebase.js" login
echo.
echo Login completado. Ahora ejecuta firebase-deploy.bat
pause
