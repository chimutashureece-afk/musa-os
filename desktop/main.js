// Musa OS for Windows. The window loads the live Musa OS site, so the app is always
// up to date; the site's service worker and Firestore's offline cache keep it working
// when the internet drops (after the first successful start).
const { app, BrowserWindow, Menu, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).appUrl; } catch { return 'https://musa-os-gray.vercel.app/'; }
})();
const ORIGIN = new URL(APP_URL).origin;
const STATE_FILE = path.join(app.getPath('userData'), 'window.json');

if (!app.requestSingleInstanceLock()) app.quit();

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { width: 1360, height: 860, maximized: false }; }
}
function saveState(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* ignore */ }
}

let win;
function createWindow() {
  const st = loadState();
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(st.width || 1360, area.width), height: Math.min(st.height || 860, area.height),
    x: st.x, y: st.y, minWidth: 900, minHeight: 600,
    title: 'Musa OS', backgroundColor: '#f4f7f5', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveState(win));

  // Links to other sites open in the normal browser; Musa OS pages stay in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });

  // First start with no internet (nothing cached yet): show a friendly retry page.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL } });
  });

  win.loadURL(APP_URL);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Musa OS', submenu: [
      { label: 'Reload', accelerator: 'F5', click: () => win && win.webContents.reload() },
      { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() },
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'quit', label: 'Exit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
