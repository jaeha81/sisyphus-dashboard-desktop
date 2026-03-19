'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ── 개발 모드 감지 ─────────────────────────────────────
const isDev = process.argv.includes('--dev') || !app.isPackaged;

// ── 경로 해석 ──────────────────────────────────────────
const APP_ROOT = app.isPackaged
  ? path.dirname(process.execPath)
  : __dirname;

const PLUGINS_DIR = path.join(APP_ROOT, 'plugins');
const ENV_FILE = path.join(APP_ROOT, '.env.local');

// ── 서버 및 플러그인 모듈 로드 ─────────────────────────
const { createServer } = require('./server/index');
const { PluginLoader }  = require('./server/plugin-loader');

// ── 전역 상태 ──────────────────────────────────────────
let mainWindow = null;
let tray       = null;
let serverInstance = null;
let pluginLoader   = null;

const PORT = 3333;

// ── 앱 단일 인스턴스 보장 ──────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── 메인 윈도우 생성 ───────────────────────────────────
function createMainWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  800,
    minHeight: 600,
    title: 'Sisyphus Dashboard',
    icon,
    backgroundColor: '#050810',
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      webviewTag:        false,
      // ttyd iframe (localhost) 접근 허용
      webSecurity:       false,
      allowRunningInsecureContent: true,
    },
    frame:      true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false, // ready-to-show 이벤트 후 표시
  });

  // 렌더러 프로세스 로드 (서버가 준비된 후)
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('close', (e) => {
    // 트레이가 있으면 닫기 대신 숨기기
    if (tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on('new-window', (e, url) => {
    e.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://localhost')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── 시스템 트레이 ──────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const trayIcon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip('Sisyphus Dashboard');

  const menu = Menu.buildFromTemplate([
    { label: '대시보드 열기', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    {
      label: '플러그인 관리',
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send('open-plugin-manager');
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── IPC 핸들러 ─────────────────────────────────────────

// 플러그인 목록 조회
ipcMain.handle('plugin:list', async () => {
  return pluginLoader ? pluginLoader.getList() : [];
});

// 플러그인 GitHub 설치
ipcMain.handle('plugin:install', async (_e, githubUrl) => {
  if (!pluginLoader) return { ok: false, error: 'Plugin loader not ready' };
  try {
    await pluginLoader.installFromGithub(githubUrl);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 플러그인 활성화/비활성화
ipcMain.handle('plugin:toggle', async (_e, pluginId) => {
  if (!pluginLoader) return { ok: false };
  try {
    const enabled = pluginLoader.toggle(pluginId);
    return { ok: true, enabled };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 플러그인 삭제
ipcMain.handle('plugin:remove', async (_e, pluginId) => {
  if (!pluginLoader) return { ok: false };
  try {
    await pluginLoader.remove(pluginId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 폴더 선택 다이얼로그 (네이티브)
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '폴더 선택',
  });
  if (result.canceled || !result.filePaths.length) return null;
  const winPath = result.filePaths[0];
  // Windows 경로를 WSL 경로로 변환
  return winPath.replace(/^([A-Z]):\\/i, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
});

// 앱 버전 정보
ipcMain.handle('app:version', () => app.getVersion());

// 앱 재시작
ipcMain.handle('app:restart', () => {
  app.relaunch();
  app.quit();
});

// ENV 저장
ipcMain.handle('env:save', async (_e, data) => {
  try {
    let content = '';
    for (const [k, v] of Object.entries(data)) {
      content += `${k}=${v}\n`;
    }
    await fs.promises.writeFile(ENV_FILE, content, 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ENV 읽기
ipcMain.handle('env:load', async () => {
  try {
    const raw = await fs.promises.readFile(ENV_FILE, 'utf-8');
    const env = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
});

// ── 앱 초기화 ──────────────────────────────────────────
app.whenReady().then(async () => {
  // 1. 플러그인 로더 초기화
  pluginLoader = new PluginLoader(PLUGINS_DIR);
  await pluginLoader.load();

  // 2. HTTP 서버 시작
  serverInstance = await createServer({
    port: PORT,
    pluginLoader,
    appRoot: APP_ROOT,
    envFile: ENV_FILE,
  });

  // 3. 윈도우 + 트레이 생성
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  // 서버 종료
  if (serverInstance?.close) {
    await new Promise(r => serverInstance.close(r)).catch(() => {});
  }
  // 플러그인 정리
  if (pluginLoader) pluginLoader.unloadAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── 전역 오류 처리 ─────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});
