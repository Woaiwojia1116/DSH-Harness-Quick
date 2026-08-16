@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo  DeepSeek Harness Launcher - C# builder
echo ================================================

set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    echo [ERROR] C# compiler not found: %CSC%
    pause
    exit /b 1
)

if not exist "src\Launcher.cs" (
    echo [ERROR] Launcher source not found: src\Launcher.cs
    pause
    exit /b 1
)

if exist "build\icon.ico" (
    echo [..] Compiling with icon...
    "%CSC%" /target:winexe /out:"dist\DeepSeek-Harness.exe" /win32icon:"build\icon.ico" /reference:System.Windows.Forms.dll "src\Launcher.cs"
) else (
    echo [..] Compiling (no icon)...
    "%CSC%" /target:winexe /out:"dist\DeepSeek-Harness.exe" /reference:System.Windows.Forms.dll "src\Launcher.cs"
)

if errorlevel 1 (
    echo.
    echo [ERROR] Compilation failed.
    pause
    exit /b 1
)

echo.
echo ================================================
echo  Done! Your launcher is at:
echo    %~dp0dist\DeepSeek-Harness.exe
echo ================================================
pause
endlocal
