'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');

const isDev = process.argv.includes('--dev') || !app.isPackaged;

const EXEC_DIR    = path.dirname(process.execPath);
const ASAR_DIR    = __dirname;

const PLUGINS_DIR    = app.isPackaged ? path.join(EXEC_DIR, 'plugins')           : path.join(ASAR_DIR, 'plugins');
const ENV_FILE       = app.isPackaged ? path.join(EXEC_DIR, '.env.local')        : path.join(ASAR_DIR, '.env.local');
const RENDERER       = app.isPackaged ? path.join(EXEC_DIR, 'renderer')          : path.join(ASAR_DIR, 'renderer');
const PROGRESS_MAP   = app.isPackaged ? path.join(EXEC_DIR, 'progress_map.json') : path.join(ASAR_DIR, 'progress_map.json');

const { createServer } = require('./server/index');
const { PluginLoader }  = require('./server/plugin-loader');

let mainWindow     = null;
let tray           = null;
let serverInstance = null;
let pluginLoader   = null;

const PORT = 13333;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function getIcon() {
  const candidates = [
    path.join(EXEC_DIR, 'resources', 'assets', 'icon.ico'),
    path.join(ASAR_DIR, 'assets', 'icon.ico'),
    path.join(EXEC_DIR, 'resources', 'assets', 'icon.png'),
    path.join(ASAR_DIR, 'assets', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  }
  return undefined;
}

function createMainWindow() {
  const icon = getIcon();

  mainWindow = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    title: 'Sisyphus Dashboard',
    icon,
    backgroundColor: '#050810',
    webPreferences: {
      preload:                     path.join(ASAR_DIR, 'preload.js'),
      contextIsolation:            true,
      nodeIntegration:             false,
      webSecurity:                 false,
      allowRunningInsecureContent: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('close', (e) => {
    if (tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const icon = getIcon();
  const trayIcon = icon
    ? icon.resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip('Sisyphus Dashboard');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '대시보드 열기', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: '플러그인 관리', click: () => { mainWindow?.show(); mainWindow?.webContents.send('open-plugin-manager'); } },
    { type: 'separator' },
    { label: '종료', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

ipcMain.handle('plugin:list',    async ()        => pluginLoader ? pluginLoader.getList() : []);
ipcMain.handle('plugin:install', async (_e, url) => { try { await pluginLoader.installFromGithub(url); return { ok: true }; } catch(e) { return { ok: false, error: e.message }; } });
ipcMain.handle('plugin:toggle',  async (_e, id)  => { try { const enabled = pluginLoader.toggle(id); return { ok: true, enabled }; } catch(e) { return { ok: false, error: e.message }; } });
ipcMain.handle('plugin:remove',  async (_e, id)  => { try { await pluginLoader.remove(id); return { ok: true }; } catch(e) { return { ok: false, error: e.message }; } });

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: '폴더 선택' });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0]
    .replace(/^([A-Z]):\\/i, (_, d) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, '/');
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:restart',  () => { app.relaunch(); app.quit(); });

ipcMain.handle('env:save', async (_e, data) => {
  try {
    await fs.promises.writeFile(ENV_FILE, Object.entries(data).map(([k,v]) => `${k}=${v}`).join('\n') + '\n', 'utf-8');
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('env:load', async () => {
  try {
    const env = {};
    for (const line of (await fs.promises.readFile(ENV_FILE, 'utf-8')).split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch { return {}; }
});

app.whenReady().then(async () => {
  try {
    pluginLoader = new PluginLoader(PLUGINS_DIR);
    await pluginLoader.load();

    serverInstance = await createServer({
      port:            PORT,
      pluginLoader,
      appRoot:         EXEC_DIR,
      rendererDir:     RENDERER,
      envFile:         ENV_FILE,
      progressMapFile: PROGRESS_MAP,
    });

    createMainWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  } catch (err) {
    dialog.showErrorBox('Sisyphus Dashboard 시작 오류', `서버를 시작할 수 없습니다.\n\n${err.message}\n\nWSL2가 실행 중인지 확인하세요.`);
    app.quit();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (serverInstance?.close) await new Promise(r => serverInstance.close(r)).catch(() => {});
  if (pluginLoader) pluginLoader.unloadAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException',  (err)    => console.error('[main] uncaughtException:',  err.message));
process.on('unhandledRejection', (reason) => console.error('[main] unhandledRejection:', reason));
