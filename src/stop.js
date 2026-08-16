#!/usr/bin/env node
/**
 * DeepSeek Harness — stop helper
 *
 * Kills any `dsh web` / @deepseek-ai/dsh node processes and removes the
 * launcher lock file. Run from a terminal:
 *
 *     node src/stop.js      (source)
 *     npm run stop          (source)
 *
 * Because the launcher spawns dsh fully detached, closing the launcher does
 * NOT stop the service — this script does.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_FILE = path.join(os.tmpdir(), 'deepseek-harness-launcher.lock');
const DSH_PID_FILE = path.join(os.tmpdir(), 'deepseek-harness-dsh.pid');

// ---------- 新增：PowerShell 辅助函数 ----------
function runPowershell(script) {
  // 使用 -EncodedCommand (Base64) 执行，避免引号嵌套导致的解析错误。
  // 脚本内部的双引号（如 -Filter "name = 'node.exe'"）会破坏外层 "..." 包裹，
  // Base64 编码后整个脚本作为单一 token 传入，彻底绕开转义问题。
  const utf16le = Buffer.from(script, 'utf16le');
  const base64 = utf16le.toString('base64');
  const cmd = `powershell -NoProfile -EncodedCommand ${base64}`;
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

// ---------- 替换原 findDshPids ----------
function findDshPids() {
  // 使用 Get-CimInstance 替代 wmic，获取所有 node.exe 进程的 PID 和命令行
  const psScript = `
    Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Select-Object ProcessId, CommandLine |
    ConvertTo-Csv -NoTypeInformation
  `;
  const out = runPowershell(psScript);
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pids = [];
  
  for (const line of lines) {
    // CSV 格式: "ProcessId","CommandLine"
    if (line.startsWith('"ProcessId"')) continue; // 跳过标题行
    const parts = line.split('","');
    if (parts.length < 2) continue;
    const pid = parts[0].replace(/^"/, '').replace(/"$/, '');
    const cmdLine = parts.slice(1).join('","').replace(/"$/, '').replace(/^"/, '');
    if (/dsh|deepseek-ai/i.test(cmdLine)) {
      pids.push(pid);
    }
  }
  return pids;
}

// ---------- 替换原 isDshPid ----------
function isDshPid(pid) {
  if (!isPidAlive(pid)) return false;
  try {
    const psScript = `
      Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" |
      Select-Object CommandLine |
      ConvertTo-Csv -NoTypeInformation
    `;
    const out = runPowershell(psScript);
    // 解析 CSV 获取 CommandLine 字段
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('"CommandLine"')) continue;
      // 提取 CommandLine 内容（可能包含逗号，需要特殊处理）
      const match = line.match(/^"(.+)"$/);
      if (match) {
        return /dsh|deepseek-ai/i.test(match[1]);
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ---------- 以下函数保持不变 ----------
function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    run(`tasklist /FI "PID eq ${pid}" /NH`);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  run(`taskkill /PID ${pid} /T /F`);
}

function clearDshPidFile() {
  try { fs.unlinkSync(DSH_PID_FILE); } catch { /* ignore */ }
}

function main() {
  // --- Strategy 1: PID-file fast path ---
  let pidFromFile = null;
  try {
    pidFromFile = parseInt(fs.readFileSync(DSH_PID_FILE, 'utf8').trim(), 10);
  } catch {
    /* no PID file — fall through to scan */
  }

  if (pidFromFile && isDshPid(pidFromFile)) {
    console.log(`Stopping dsh process from PID file: ${pidFromFile}`);
    try {
      killPid(pidFromFile);
      console.log('Done.');
    } catch (e) {
      console.warn(`  could not kill PID ${pidFromFile}:`, e.message);
    }
    clearDshPidFile();
  } else {
    if (pidFromFile) {
      clearDshPidFile();
    }

    // --- Strategy 2: PowerShell scan fallback ---
    const pids = findDshPids();
    if (pids.length === 0) {
      console.log('No running dsh web process found.');
    } else {
      console.log(`Stopping ${pids.length} dsh process(es): ${pids.join(', ')}`);
      for (const pid of pids) {
        try {
          killPid(pid);
        } catch (e) {
          console.warn(`  could not kill PID ${pid}:`, e.message);
        }
      }
      console.log('Done.');
    }
  }

  // Clean the lock file
  try {
    fs.unlinkSync(LOCK_FILE);
    console.log('Lock file removed.');
  } catch {
    /* no lock file — nothing to do */
  }
}

main();