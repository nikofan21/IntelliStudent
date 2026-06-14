@echo off

taskkill /F /IM node.exe
taskkill /F /IM ngrok.exe
taskkill /F /IM python.exe

echo All IntelliStudent services stopped.
pause
