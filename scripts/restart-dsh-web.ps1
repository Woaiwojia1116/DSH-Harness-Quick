# Restart dsh web so newly installed profile bundles (maid-atelier skin) take
# effect. Run as a managed background job: kills the process currently
# listening on 127.0.0.1:3080, then spawns `npx @deepseek-ai/dsh web` the same
# way the desktop launcher does (hidden, detached, cwd = launcher dir), then
# stays alive as the server's keeper so the harness does not reap it.
$ErrorActionPreference = 'Continue'
$log = 'F:\dsh-destop\.skin-dl\restart-web.log'
function Log($m) { ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) | Out-File -Append -Encoding utf8 $log }
Log '=== restart start ==='

# 1) Small delay so the in-flight agent turn can deliver its final message.
Start-Sleep -Seconds 15

# 2) Find and kill whatever listens on 127.0.0.1:3080.
$killed = @()
try {
    $lines = netstat -ano | Select-String '127.0.0.1:3080\s' | Select-String 'LISTENING'
    foreach ($line in $lines) {
        $pid2 = ($line.ToString().Trim() -split '\s+')[-1]
        if ($pid2 -match '^\d+$') {
            taskkill /PID $pid2 /T /F 2>&1 | Out-Null
            $killed += $pid2
            Log "killed pid $pid2"
        }
    }
} catch { Log "kill step failed: $_" }
if ($killed.Count -eq 0) { Log 'no listener found on 3080' }

# Also try the launcher pid file (harmless if absent).
try {
    $pf = Join-Path $env:TEMP 'deepseek-harness-dsh.pid'
    if (Test-Path $pf) { Remove-Item $pf -ErrorAction SilentlyContinue }
} catch { }

# 3) Wait until port 3080 is free.
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
    $busy = netstat -ano | Select-String '127.0.0.1:3080\s' | Select-String 'LISTENING'
    if (-not $busy) { break }
    Start-Sleep -Milliseconds 600
}
Log 'port free or timeout'

# 4) Spawn the new dsh web server (same as the launcher: cmd /c npx ...).
Remove-Item Env:DSH_SESSION_ID, Env:DSH_SESSION_JSONL, Env:DSH_WEB_URL, Env:DSH_SHELL -ErrorAction SilentlyContinue
$work = 'F:\dsh-destop'
$p2 = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npx @deepseek-ai/dsh web' -WorkingDirectory $work -WindowStyle Hidden -PassThru
Log "spawned dsh web cmd pid=$($p2.Id) cwd=$work"

# 5) Wait until the server answers.
$deadline = (Get-Date).AddSeconds(120)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', 3080)
        $c.Close()
        $ok = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
Log "server ready=$ok"

# 6) Keep this job alive while the server runs (server's keeper).
if ($ok) {
    Log 'keeping job alive as server keeper'
    Wait-Process -Id $p2.Id -ErrorAction SilentlyContinue
    Log 'server process exited; job done'
} else {
    Log 'server did not become ready'
}
