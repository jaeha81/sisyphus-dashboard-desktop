'use strict';

const { execSync, spawn } = require('child_process');
const os   = require('os');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';

let _wslHome    = null;
let _wslDistro  = null;

function getWslDistro() {
  if (_wslDistro) return _wslDistro;
  if (!IS_WINDOWS) { _wslDistro = 'Ubuntu'; return _wslDistro; }
  try {
    const raw = execSync('wsl.exe -l -q', { encoding: 'utf16le', timeout: 5000 });
    _wslDistro = raw.split(/\r?\n/)
      .map(s => s.replace(/\0/g, '').trim())
      .filter(Boolean)[0] || 'Ubuntu';
  } catch {
    _wslDistro = 'Ubuntu';
  }
  return _wslDistro;
}

function getWslHome() {
  if (_wslHome) return _wslHome;
  if (!IS_WINDOWS) {
    _wslHome = os.homedir();
    return _wslHome;
  }
  try {
    _wslHome = execSync('wsl.exe -e bash -c "printf $HOME"', {
      encoding: 'utf-8', timeout: 5000,
    }).trim();
  } catch {
    _wslHome = `/home/${os.userInfo().username}`;
  }
  return _wslHome;
}

function wslToUNC(wslPath) {
  if (!IS_WINDOWS) return wslPath;
  return `\\\\wsl$\\${getWslDistro()}${wslPath.replace(/\//g, '\\')}`;
}

function winToWsl(winPath) {
  if (!winPath) return winPath;
  if (!IS_WINDOWS) return winPath;
  return winPath
    .replace(/^([A-Za-z]):[\\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, '/');
}

function wslToWin(wslPath) {
  if (!wslPath) return wslPath;
  if (!IS_WINDOWS) return wslPath;
  const m = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
  if (m) return `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}`;
  return wslToUNC(wslPath);
}

function resolveForFs(anyPath) {
  if (!anyPath) return anyPath;
  if (!IS_WINDOWS) return anyPath;
  if (/^[A-Za-z]:/.test(anyPath)) return anyPath;
  return wslToWin(anyPath);
}

function wslSpawn(bashCmd, spawnOpts = {}) {
  if (IS_WINDOWS) {
    return spawn('wsl.exe', ['-e', 'bash', '-c', bashCmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...spawnOpts,
    });
  }
  return spawn('bash', ['-c', bashCmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOpts,
  });
}

function wslExecSync(bashCmd, opts = {}) {
  if (IS_WINDOWS) {
    return execSync(`wsl.exe -e bash -c ${JSON.stringify(bashCmd)}`, {
      encoding: 'utf-8', timeout: 10000, ...opts,
    }).trim();
  }
  return execSync(bashCmd, {
    encoding: 'utf-8', timeout: 10000, shell: '/bin/bash', ...opts,
  }).trim();
}

function wslExecFileSync(bin, args, opts = {}) {
  if (IS_WINDOWS) {
    const argStr = args.map(a => JSON.stringify(String(a))).join(' ');
    return execSync(`wsl.exe -e ${bin} ${argStr}`, {
      encoding: 'utf-8', timeout: 10000, ...opts,
    });
  }
  const { execFileSync } = require('child_process');
  return execFileSync(bin, args, { encoding: 'utf-8', timeout: 10000, ...opts });
}

module.exports = {
  IS_WINDOWS,
  getWslDistro,
  getWslHome,
  wslToUNC,
  winToWsl,
  wslToWin,
  resolveForFs,
  wslSpawn,
  wslExecSync,
  wslExecFileSync,
};
