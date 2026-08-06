#!/usr/bin/env node
// Kills whatever's listening on the dev server's port — a manual backstop
// for when Ctrl+C doesn't reach the server process (see server.ts's shutdown
// handler comment for why that can happen on Windows/Git Bash).
import { execSync } from 'node:child_process';

const port = Number(process.argv[2]) || 8080;

function killWindows() {
  // Get-NetTCPConnection exits non-zero when nothing matches, even with
  // -ErrorAction SilentlyContinue suppressing the error text — that's not a
  // real failure here, just "nothing listening."
  let out = '';
  try {
    out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
    )
      .toString()
      .trim();
  } catch {
    // fall through with out = '' below
  }
  const pids = out.split(/\s+/).filter(Boolean);
  if (pids.length === 0) {
    console.log(`Nothing listening on port ${port}.`);
    return;
  }
  for (const pid of pids) {
    execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`);
    console.log(`Killed PID ${pid} (port ${port}).`);
  }
}

function findPosixPids() {
  // lsof is precise but isn't installed by default on a lot of Linux boxes
  // (minimal server images, containers).
  try {
    const out = execSync(`lsof -ti tcp:${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) return out.split('\n').filter(Boolean);
  } catch {
    // lsof missing, or nothing matched — try the next tool
  }

  // ss (iproute2) ships by default on virtually every mainstream Linux
  // distro even when lsof doesn't.
  try {
    const out = execSync(`ss -H -tlnp sport = :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const pids = new Set(Array.from(out.matchAll(/pid=(\d+)/g), (m) => m[1]));
    if (pids.size) return [...pids];
  } catch {
    // ss missing, or nothing matched
  }

  return [];
}

function killPosix() {
  const pids = findPosixPids();
  if (pids.length === 0) {
    console.log(`Nothing listening on port ${port}.`);
    return;
  }
  execSync(`kill -9 ${pids.join(' ')}`);
  console.log(`Killed PID(s) ${pids.join(', ')} (port ${port}).`);
}

if (process.platform === 'win32') killWindows();
else killPosix();
