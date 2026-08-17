@echo off
setlocal

echo ================================================
echo  DeepSeek Harness Launcher - one-click builder
echo ================================================

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: --- .NET C# compiler check ---
set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    echo [ERROR] C# compiler not found: %CSC%
    echo         Install .NET Framework 4.x or Visual Studio.
    pause
    exit /b 1
)
echo [OK] C# compiler found

:: --- Launcher source check ---
if not exist "src\Launcher.cs" (
    echo [ERROR] Launcher source not found: src\Launcher.cs
    pause
    exit /b 1
)

:: --- generate icon if needed ---
if exist "build\icon.ico" goto :compile

if not exist "assets\whale.png" (
    echo [WARN] assets\whale.png not found - building without icon.
    goto :compile
)

:: --- check Node.js (required for icon generation) ---
where node >nul 2>&1
if errorlevel 1 (
    echo [WARN] Node.js not found - cannot regenerate build\icon.ico.
    echo         Run "node scripts\make-icon.js" manually, or reinstall Node.js.
    goto :compile
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js %%v

echo.
echo [..] Generating icon from assets\whale.png...
if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo [WARN] npm install failed - building without icon.
        goto :compile
    )
)
node scripts\make-icon.js
if errorlevel 1 (
    echo [WARN] Icon generation failed - building without icon.
)

:: --- compile the C# launcher ---
:compile
echo.
echo [..] Compiling DeepSeek-Harness.exe...
node scripts\compile-cs.js
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See messages above.
    pause
    exit /b 1
)

echo.
echo ================================================
echo  Done! Your launcher is at:
echo    %ROOT%dist\DeepSeek-Harness.exe
echo.
echo  Right-click -^> Send to -^> Desktop (create shortcut)
echo  then double-click the shortcut to launch dsh web.
echo ================================================
pause
endlocal
