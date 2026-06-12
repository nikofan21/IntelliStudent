@echo off
chcp 65001 >nul
title IntelliStudent Launcher
cd /d "%~dp0"

echo =====================================
echo     IntelliStudent Starting...
echo =====================================
echo.

REM ---- Ищем Python 3.12 или 3.11 ----
set "PYTHON_CMD="

py -3.12 --version >nul 2>nul
if %errorlevel%==0 set "PYTHON_CMD=py -3.12"

if not defined PYTHON_CMD (
    py -3.11 --version >nul 2>nul
    if %errorlevel%==0 set "PYTHON_CMD=py -3.11"
)

if not defined PYTHON_CMD (
    echo [ERROR] Python 3.12 or 3.11 not found.
    echo Install Python 3.12 from https://www.python.org/downloads/
    echo.
    echo Python 3.14 is NOT recommended for this project.
    pause
    exit /b 1
)

echo [INFO] Using %PYTHON_CMD%

REM ---- Проверка Node.js ----
where node >nul 2>nul
if not %errorlevel%==0 (
    echo [ERROR] Node.js not found
    echo Install Node.js LTS from https://nodejs.org
    pause
    exit /b 1
)

where npm >nul 2>nul
if not %errorlevel%==0 (
    echo [ERROR] npm not found
    pause
    exit /b 1
)

REM ---- Создание venv312 если его нет ----
if not exist "venv312\Scripts\python.exe" (
    echo [INFO] Creating virtual environment...
    %PYTHON_CMD% -m venv venv312
    if not exist "venv312\Scripts\python.exe" (
        echo [ERROR] Failed to create venv312
        pause
        exit /b 1
    )
)

REM ---- Активация venv ----
call "venv312\Scripts\activate.bat"
if errorlevel 1 (
    echo [ERROR] Failed to activate venv312
    pause
    exit /b 1
)

REM ---- Обновление pip tools ----
echo [INFO] Updating pip tools...
python -m pip install --upgrade pip setuptools wheel

REM ---- Проверка / установка backend зависимостей ----
if exist "requirements.txt" (
    echo [INFO] Checking backend dependencies...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [ERROR] Backend dependencies installation failed.
        echo Most likely reason: unsupported Python version.
        echo Use Python 3.12 or 3.11.
        pause
        exit /b 1
    )
) else (
    echo [WARNING] requirements.txt not found
)

REM ---- Проверка / установка frontend зависимостей ----
if exist "frontend\package.json" (
    echo [INFO] Checking frontend dependencies...
    pushd "frontend"
    call npm install
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    popd
) else (
    echo [ERROR] frontend\package.json not found
    pause
    exit /b 1
)

echo.
echo Starting Backend (8000)...
start "IntelliStudent Backend" cmd /k call "%~dp0venv312\Scripts\activate.bat" ^& python -m uvicorn backend.main:app --reload --port 8000

echo.
echo Starting AI Service (8001)...
if exist "ai_service\main.py" (
    start "IntelliStudent AI Service" cmd /k call "%~dp0venv312\Scripts\activate.bat" ^& python -m uvicorn ai_service.main:app --reload --port 8001
) else (
    echo [WARNING] ai_service\main.py not found, AI service skipped
)

echo.
echo Starting Frontend...
start "IntelliStudent Frontend" cmd /k cd /d "%~dp0frontend" ^& npm run dev

timeout /t 5 >nul
start http://localhost:5173

echo.
echo =====================================
echo     All services launched!
echo =====================================
pause