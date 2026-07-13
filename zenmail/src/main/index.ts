import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { openCache, getSetting } from './cache';
import { registerIpc, getProvider } from './ipc';
import { startSnoozeDaemon, stopSnoozeDaemon } from './snooze';

if (started) app.quit();

// E2E test harness hook only — never enabled unless ZENMAIL_E2E_PORT is set (see zenmail/e2e/).
if (process.env.ZENMAIL_E2E_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ZENMAIL_E2E_PORT);
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: getSetting('theme') === 'dark' ? '#0f0f0f' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // preload는 main의 env를 못 보므로 argv로 E2E 모드를 전달한다 (preload.ts에서 검사)
      ...(process.env.ZENMAIL_E2E_PORT ? { additionalArguments: ['--zenmail-e2e'] } : {}),
    },
  });

  // mail links open in the default browser, never in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      e.preventDefault();
      if (url.startsWith('http')) void shell.openExternal(url);
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.whenReady().then(() => {
  openCache();
  registerIpc(() => mainWindow);
  startSnoozeDaemon(getProvider, () => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopSnoozeDaemon();
});
