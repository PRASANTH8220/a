@echo off
title NexTrade Launcher

echo ================================================
echo   NexTrade Trading Terminal - Starting...
echo ================================================
echo.

echo [1/4] Checking Redis...
where redis-server >nul 2>&1
if %errorlevel% neq 0 (
    echo Redis not found in PATH. Trying common locations...
    if exist "C:\Program Files\Redis\redis-server.exe" (
        start "Redis" "C:\Program Files\Redis\redis-server.exe"
    ) else if exist "C:\Redis\redis-server.exe" (
        start "Redis" "C:\Redis\redis-server.exe"
    ) else (
        echo WARNING: Redis not found. Please start Redis manually.
    )
) else (
    start "Redis" redis-server
)
timeout /t 2 /nobreak >nul

echo [2/4] Checking MongoDB...
where mongod >nul 2>&1
if %errorlevel% neq 0 (
    echo MongoDB not found in PATH. Trying common locations...
    if exist "C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe" (
        start "MongoDB" "C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe" --dbpath "C:\data\db"
    ) else if exist "C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe" (
        start "MongoDB" "C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe" --dbpath "C:\data\db"
    ) else (
        echo WARNING: MongoDB not found. Please start MongoDB manually.
    )
) else (
    if not exist "C:\data\db" mkdir "C:\data\db"
    start "MongoDB" mongod --dbpath "C:\data\db"
)
timeout /t 3 /nobreak >nul

echo [3/4] Starting NexTrade Server...
cd /d "%~dp0server"
if not exist node_modules (
    echo Installing server dependencies...
    call npm install
)
start "NexTrade Server" cmd /k "node index.js"
timeout /t 3 /nobreak >nul

echo [4/4] Starting NexTrade Client...
cd /d "%~dp0client"
if not exist node_modules (
    echo Installing client dependencies...
    call npm install
)
start "NexTrade Client" cmd /k "npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo ================================================
echo   All services started!
echo   Open: http://localhost:5173
echo ================================================
echo.
start http://localhost:5173
pause