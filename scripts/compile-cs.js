#!/usr/bin/env node
/**
 * Build the C# Windows GUI launcher.
 *
 *   node scripts/compile-cs.js
 *
 * Produces: <projectRoot>/dist/DeepSeek-Harness.exe
 *   - WINDOWS_GUI subsystem (no console window ever)
 *   - whale icon embedded (if build/icon.ico exists)
 *
 * This replaces the pkg-based build, which needs to download/compile a
 * Node.js base binary and is unreliable in offline / non-TTY environments.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const SRC = path.join(ROOT, 'src', 'Launcher.cs');
const OUT = path.join(ROOT, 'dist', 'DeepSeek-Harness.exe');
const ICO = path.join(ROOT, 'build', 'icon.ico');

function fail(msg) {
  console.error('[ERROR] ' + msg);
  process.exit(1);
}

console.log('=== C# launcher build ===');

if (!fs.existsSync(CSC)) fail('C# compiler not found: ' + CSC);
if (!fs.existsSync(SRC)) fail('Source not found: ' + SRC);

const args = [
  '/target:winexe',
  '/out:' + OUT,
  '/reference:System.Windows.Forms.dll',
  '/reference:System.Drawing.dll',
];
if (fs.existsSync(ICO)) {
  args.push('/win32icon:' + ICO);
}
args.push(SRC);

console.log('[' + (fs.existsSync(ICO) ? 'with icon' : 'no icon') + '] compiling...');
const result = spawnSync(CSC, args, { stdio: 'inherit' });

if (result.status !== 0) {
  fail('compilation failed (exit code ' + result.status + ')');
}

const stats = fs.statSync(OUT);
console.log('\nBuild complete: ' + OUT);
console.log('   Size: ' + (stats.size / 1024).toFixed(1) + ' KB');
