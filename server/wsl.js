'use strict';

const { execSync, spawn } = require('child_process');
const os   = require('os');
const path = require('path');

let _wslHome    = null;
let _wslDistro  = null;

function getWslDistro() {
  if (_wslDistro) return _wslDistro;
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
  return `\\\\wsl$\\${getWslDistro()}${wslPath.replace(/\//g, '\\')}`;
}

function winToWsl(winPath) {
  if (!winPath) return winPath;
  return winPath
    .replace(/^([A-Za-z]):[\\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, '/');
}

function wslToWin(wslPath) {
  if (!wslPath) return wslPath;
  const m = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
  if (m) return `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}`;
  return wslToUNC(wslPath);
}

function resolveForFs(anyPath) {
  if (!anyPath) return anyPath;
  if (/^[A-Za-z]:/.test(anyPath)) return anyPath;
  return wslToWin(anyPath);
}

function wslSpawn(bashCmd, spawnOpts = {}) {
  return spawn('wsl.exe', ['-e', 'bash', '-c', bashCmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOpts,
  });
}

function wslExecSync(bashCmd, opts = {}) {
  return execSync(`wsl.exe -e bash -c ${JSON.stringify(bashCmd)}`, {
    encoding: 'utf-8',
    timeout: 10000,
    ...opts,
  }).trim();
}

function wslExecFileSync(bin, args, opts = {}) {
  const argStr = args.map(a => JSON.stringify(String(a))).join(' ');
  return execSync(`wsl.exe -e ${bin} ${argStr}`, {
    encoding: 'utf-8',
    timeout: 10000,
    ...opts,
  });
}

module.exports = {
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
