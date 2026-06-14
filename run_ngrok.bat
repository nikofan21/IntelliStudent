@echo off
title IntelliStudent + Ngrok

echo ========================================
echo IntelliStudent Public Launch
echo ========================================

echo.
echo Starting Backend...
start "Backend" cmd /k "cd /d %~dp0 && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

timeout /t 3 >nul

echo.
echo Starting AI Service...
start "AI Service" cmd /k "cd /d %~dp0 && python -m uvicorn ai_service.main:app --host 127.0.0.1 --port 8001"

timeout /t 3 >nul

echo.
echo Starting Frontend...
start "Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev -- --host 0.0.0.0 --port 5173"

timeout /t 8 >nul

echo.
echo Starting Ngrok...
start "Ngrok" cmd /k "ngrok http 5173"

echo.
echo ========================================
echo All services started
echo Backend  : http://127.0.0.1:8000
echo AI       : http://127.0.0.1:8001
echo Frontend : http://127.0.0.1:5173
echo ========================================

pause
