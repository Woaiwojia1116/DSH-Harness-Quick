#!/usr/bin/env node
/**
 * DeepSeek Harness — stop helper
 *
 * Kills any `dsh web` / `@deepseek-ai/dsh` node processes and removes the
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

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function findDshPids() {
  // List all node processes with their command lines.
  const out = run('wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /FORMAT:CSV');
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pids = [];
  for (const line of lines) {
    // CSV: Node,CommandLine,ProcessId
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const cmdLine = parts.slice(1, parts.length - 1).join(','); // commas inside the command line
    const pid = parts[parts.length - 1];
    if (/dsh|deepseek-ai/i.test(cmdLine)) {
      pids.push(pid);
    }
  }
  return pids;
}

function main() {
  const pids = findDshPids();
  if (pids.length === 0) {
    console.log('No running dsh web process found.');
  } else {
    console.log(`Stopping ${pids.length} dsh process(es): ${pids.join(', ')}`);
    for (const pid of pids) {
      try {
        run(`taskkill /PID ${pid} /F`);
      } catch (e) {
        console.warn(`  could not kill PID ${pid}:`, e.message);
      }
    }
    console.log('Done.');
  }

  // Clean the lock file so a fresh launch isn't blocked.
  try {
    fs.unlinkSync(LOCK_FILE);
    console.log('Lock file removed.');
  } catch {
    /* no lock file — nothing to do */
  }
}

main();
