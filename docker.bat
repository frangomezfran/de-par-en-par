@echo off

echo Deteniendo y eliminando contenedor anterior (si existe)...
docker.exe compose down --remove-orphans
docker.exe rm -f amelia-app >nul 2>&1

echo Construyendo nueva imagen y levantando contenedor...
docker.exe compose up -d --build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] No se pudo levantar el contenedor. Verifica que Docker Desktop este abierto.
    pause
    exit /b %errorlevel%
)

echo Limpiando imagenes viejas sin uso...
docker.exe image prune -f >nul 2>&1

echo.
echo La aplicacion esta corriendo en http://localhost:3001
pause
