@echo off
title IntelliStudent Stop

echo Stopping IntelliStudent...

taskkill /F /FI "WINDOWTITLE eq IntelliStudent Backend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq IntelliStudent AI*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq IntelliStudent Frontend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq IntelliStudent Ngrok*" >nul 2>&1

taskkill /F /IM ngrok.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

echo.
echo IntelliStudent stopped.
timeout /t 2 >nul
exit