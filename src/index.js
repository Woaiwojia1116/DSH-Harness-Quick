#!/usr/bin/env node
/**
 * DeepSeek Harness Desktop Launcher
 *
 * Doubles as the pkg entry point. It:
 *   1. Checks that a usable Node.js exists for spawning `npx`.
 *   2. Detects whether dsh web is already serving on the harness port.
 *   3. If not, spawns `npx @deepseek-ai/dsh web` fully detached with every
 *      window hidden, then polls the port until it answers.
 *   4. Opens the default browser once the service is truly ready.
 *
 * Built as a WINDOWS_GUI subsystem exe so no console window ever appears.
 */

'use strict';

const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// File-based logger (GUI exe has no console, so we log to a temp file)
// ---------------------------------------------------------------------------

const LOG_FILE = path.join(os.tmpdir(), 'deepseek-harness-launcher.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}

log('=== launcher start ===');
log('execPath: ' + process.execPath);
log('cwd: ' + process.cwd());
log('platform: ' + process.platform + ' arch: ' + process.arch);
log('pid: ' + process.pid);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DSH_PACKAGE = '@deepseek-ai/dsh';
const DSH_ARGS = ['web'];
const DEFAULT_PORT = 3080;
const DEFAULT_HOST = '127.0.0.1';
const POLL_INTERVAL_MS = 400;
const POLL_TIMEOUT_MS = 60_000;
const LOCK_FILE = path.join(os.tmpdir(), 'deepseek-harness-launcher.lock');
const DSH_PID_FILE = path.join(os.tmpdir(), 'deepseek-harness-dsh.pid');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortReady(port, host) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: '/', timeout: 2000 },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function findNode() {
  // 1) Try the normal PATH node.
  try {
    log('findNode: trying "where node"');
    const out = execSync('where node', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) {
      log('findNode: found via where: ' + first);
      return first;
    }
  } catch (e) {
    log('findNode: "where node" failed: ' + e.message);
  }

  // 2) Fall back to node next to the host exe.
  const hostDir = path.dirname(process.execPath);
  for (const candidate of ['node.exe', 'node']) {
    const p = path.join(hostDir, candidate);
    if (fs.existsSync(p)) {
      log('findNode: found next to exe: ' + p);
      return p;
    }
  }

  log('findNode: NOT FOUND');
  return null;
}

function findNpx(nodeExe) {
  try {
    log('findNpx: trying "where npx"');
    const out = execSync('where npx', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) {
      log('findNpx: found via where: ' + first);
      return first;
    }
  } catch (e) {
    log('findNpx: "where npx" failed: ' + e.message);
  }
  const nodeDir = path.dirname(nodeExe);
  const rootDir = path.dirname(nodeDir);
  for (const candidate of [
    path.join(nodeDir, 'npx.cmd'),
    path.join(nodeDir, 'npx'),
    path.join(rootDir, 'npx.cmd'),
    path.join(rootDir, 'npx'),
  ]) {
    if (fs.existsSync(candidate)) {
      log('findNpx: found alongside node: ' + candidate);
      return candidate;
    }
  }
  log('findNpx: NOT FOUND');
  return null;
}

function openBrowser(url) {
  log('openBrowser: ' + url);
  spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  }).unref();
}

function showMessage(title, body) {
  log('showMessage: ' + title + ' | ' + body);
  const script =
    `Add-Type -AssemblyName System.Windows.Forms;` +
    `[System.Windows.Forms.MessageBox]::Show('${body.replace(/'/g, "''")}', '${title.replace(/'/g, "''")}', 'OK', 'Warning')`;
  spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  }).unref();
}

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    log('lock acquired');
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') {
      try {
        const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
        if (pid && !isPidAlive(pid)) {
          try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
          const fd = fs.openSync(LOCK_FILE, 'wx');
          fs.writeSync(fd, String(process.pid));
          fs.closeSync(fd);
          log('stale lock replaced');
          return true;
        }
      } catch { /* fall through */ }
      log('lock held by another running launcher');
      return false;
    }
    throw err;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); log('lock released'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Core: spawn dsh web and wait for it
// ---------------------------------------------------------------------------

function spawnDsh(nodeExe, npxExe) {
  log('spawnDsh: node=' + nodeExe + ' npx=' + npxExe);
  const isCmd = process.platform === 'win32';
  let bin, args;
  if (isCmd) {
    bin = 'cmd';
    if (npxExe.endsWith('.cmd')) {
      args = ['/c', npxExe, DSH_PACKAGE, ...DSH_ARGS];
    } else {
      args = ['/c', 'npx', DSH_PACKAGE, ...DSH_ARGS];
    }
  } else {
    bin = nodeExe;
    args = ['npx', DSH_PACKAGE, ...DSH_ARGS];
  }

  log('spawnDsh: bin=' + bin + ' args=' + JSON.stringify(args));
  const child = spawn(bin, args, {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  log('spawnDsh: spawned pid=' + child.pid);
  // Persist the dsh web server PID so stop.js can kill it precisely
  // without scanning every node.exe on the machine.
  try { fs.writeFileSync(DSH_PID_FILE, String(child.pid)); } catch { /* ignore */ }
  return child;
}

async function waitForService(host, port) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let i = 0;
  while (Date.now() < deadline) {
    if (await isPortReady(port, host)) {
      log('waitForService: port ' + port + ' ready after ' + i + ' polls');
      return true;
    }
    i++;
    await sleep(POLL_INTERVAL_MS);
  }
  log('WaitForService: TIMED OUT after ' + i + ' polls');
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- 1. Ensure Node is present ------------------------------------------
  const nodeExe = findNode();
  if (!nodeExe) {
    showMessage(
      'DeepSeek Harness - Node.js required',
      'Node.js was not found on this system.\n\n' +
      'Please install Node.js LTS from https://nodejs.org and then retry.\n' +
      '(The launcher needs it to run `npx @deepseek-ai/dsh web`.)'
    );
    return;
  }

  const npxExe = findNpx(nodeExe);
  if (!npxExe) {
    showMessage(
      'DeepSeek Harness - npx required',
      'npx was not found alongside Node.js.\n\n' +
      'Please reinstall Node.js LTS from https://nodejs.org (the bundled npx is required).'
    );
    return;
  }

  // --- 2. Is the service already up? --------------------------------------
  log('checking if port ' + DEFAULT_PORT + ' already ready...');
  if (await isPortReady(DEFAULT_PORT, DEFAULT_HOST)) {
    log('service already running, opening browser');
    openBrowser(`http://${DEFAULT_HOST}:${DEFAULT_PORT}/`);
    return;
  }
  log('port ' + DEFAULT_PORT + ' not ready, will spawn');

  // --- 3. Single-instance guard -------------------------------------------
  if (!acquireLock()) {
    log('another launcher running, polling briefly then opening browser');
    for (let i = 0; i < 25; i++) {
      await sleep(POLL_INTERVAL_MS);
      if (await isPortReady(DEFAULT_PORT, DEFAULT_HOST)) {
        openBrowser(`http://${DEFAULT_HOST}:${DEFAULT_PORT}/`);
        return;
      }
    }
    openBrowser(`http://${DEFAULT_HOST}:${DEFAULT_PORT}/`);
    return;
  }

  process.on('SIGTERM', releaseLock);
  process.on('SIGINT', releaseLock);

  // --- 4. Spawn dsh web ---------------------------------------------------
  try {
    spawnDsh(nodeExe, npxExe);
  } catch (err) {
    releaseLock();
    log('spawnDsh FAILED: ' + err.message);
    showMessage(
      'DeepSeek Harness - launch failed',
      'Failed to start `dsh web`:\n' + (err && err.message ? err.message : String(err))
    );
    return;
  }

  // --- 5. Wait for it, then open the browser ------------------------------
  const ready = await waitForService(DEFAULT_HOST, DEFAULT_PORT);
  if (ready) {
    openBrowser(`http://${DEFAULT_HOST}:${DEFAULT_PORT}/`);
    // Keep the lock; the hidden launcher stays alive so the lock is meaningful.
  } else {
    releaseLock();
    log('service did not become ready in time');
    showMessage(
      'DeepSeek Harness - slow start',
      `dsh web did not respond on port ${DEFAULT_PORT} within ` +
      `${Math.round(POLL_TIMEOUT_MS / 1000)}s.\n\n` +
      'Opening the browser anyway - it may finish loading in a moment.\n' +
      'If the page stays blank, try double-clicking the launcher again.'
    );
    openBrowser(`http://${DEFAULT_HOST}:${DEFAULT_PORT}/`);
  }
}

main().catch((err) => {
  log('FATAL: ' + err.message + '\n' + err.stack);
  showMessage('DeepSeek Harness - unexpected error', String(err));
});
