@echo off
title IntelliStudent Launcher

echo ========================================
echo IntelliStudent + Ngrok
echo ========================================

echo.
echo Starting Backend...
start "IntelliStudent Backend" cmd /k "cd /d %~dp0 && python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

timeout /t 3 >nul

echo.
echo Starting AI Service...
start "IntelliStudent AI" cmd /k "cd /d %~dp0 && python -m uvicorn ai_service.main:app --host 127.0.0.1 --port 8001"

timeout /t 3 >nul

echo.
echo Starting Frontend...
start "IntelliStudent Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host 0.0.0.0 --port 5173"

timeout /t 8 >nul

echo.
echo Starting Ngrok...
start "IntelliStudent Ngrok" cmd /k "ngrok http 5173"

echo.
echo ========================================
echo Backend  : http://127.0.0.1:8000
echo AI       : http://127.0.0.1:8001
echo Frontend : http://127.0.0.1:5173
echo ========================================

pause