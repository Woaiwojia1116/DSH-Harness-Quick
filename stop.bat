@echo off
setlocal

echo Stopping DeepSeek Harness service...
cd /d "%~dp0"
call node src\stop.js
pause
endlocal
