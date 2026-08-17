@echo off
echo ========================================
echo   ImmoFlow - Starten
echo ========================================
echo.

echo Pruefe Node.js Installation...
node -v >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Node.js ist nicht installiert!
    echo Bitte installiere Node.js von https://nodejs.org
    pause
    exit /b 1
)

echo Node.js gefunden.
echo.

echo Installiere Abhaengigkeiten...
call npm install
if errorlevel 1 (
    echo FEHLER: npm install fehlgeschlagen!
    pause
    exit /b 1
)

echo.
echo Starte Entwicklungsserver...
echo Oeffne http://localhost:8080 im Browser
echo.
echo Druecke Strg+C zum Beenden.
echo.

call npm run dev
