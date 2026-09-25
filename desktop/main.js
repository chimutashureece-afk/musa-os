// Musa OS for Windows. The window loads the live Musa OS site (so it's always up to date);
// the site's offline cache keeps it working when the internet drops. This file adds the
// things that make it a proper Windows program: a splash screen, a native title bar with
// the usual window buttons, Start-menu shortcuts, a taskbar badge and native menus.
const { app, BrowserWindow, Menu, shell, screen, ipcMain, nativeImage, Notification } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.MUSA_URL || (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).appUrl; } catch { return 'https://musaos.online/'; }
})();
const ORIGIN = new URL(APP_URL).origin;
const STATE_FILE = path.join(app.getPath('userData'), 'window.json');
const TITLE_BAR = 36;

app.setAppUserModelId('os.musa.school'); // taskbar grouping + Windows notifications
if (!app.requestSingleInstanceLock()) app.quit();

const routeFromArgs = (argv) => { const a = argv.find((x) => x.startsWith('--route=')); return a ? a.slice(8) : null; };

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { width: 1360, height: 860, maximized: true }; }
}
function saveState(win) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* ignore */ }
}

let win, splash;

function createSplash() {
  splash = new BrowserWindow({
    width: 380, height: 260, frame: false, resizable: false, movable: true, center: true, show: false,
    backgroundColor: '#032619', skipTaskbar: true, alwaysOnTop: true, icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash && splash.show());
}

function createWindow() {
  const st = loadState();
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(st.width || 1360, area.width), height: Math.min(st.height || 860, area.height),
    x: st.x, y: st.y, minWidth: 960, minHeight: 620,
    title: 'Musa OS', backgroundColor: '#f4f7f5', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    // our own title bar is drawn by the app; Windows draws the minimise / maximise / close buttons
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#032619', symbolColor: '#ffffff', height: TITLE_BAR },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setVisualZoomLevelLimits(1, 1); // no pinch-zoom like a web page

  let shown = false;
  const reveal = () => {
    if (shown) return; shown = true;
    if (st.maximized) win.maximize();
    win.show();
    if (splash) { splash.destroy(); splash = null; }
  };
  win.webContents.once('did-finish-load', () => setTimeout(reveal, 150));
  setTimeout(reveal, 12000); // never leave people staring at the splash
  win.on('close', () => saveState(win));

  // Links to other sites open in the normal browser; Musa OS pages stay in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) return { action: 'allow' };
    // Google sign-in for the owners' console opens Firebase's auth window
    if (/\/__\/auth\/handler|^https:\/\/accounts\.google\.com\//.test(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });

  // Right-click: a native Cut / Copy / Paste menu (with spelling fixes) instead of nothing.
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 4)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
      if (items.length) items.push({ type: 'separator' });
    }
    if (p.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // First start with no internet (nothing cached yet): show a friendly retry page.
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL } }); reveal(); }
  });

  const r = routeFromArgs(process.argv);
  win.loadURL(r ? `${APP_URL}#${r}` : APP_URL);
}

// --- bridge from the web app ---------------------------------------------------
ipcMain.on('app-version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.on('titlebar', (_e, c) => { try { win && win.setTitleBarOverlay({ ...c, height: TITLE_BAR }); } catch { /* older Windows */ } });
let lastBadge = 0;
const badgeIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'badge.png'));
ipcMain.on('badge', (_e, n) => {
  if (!win) return;
  win.setOverlayIcon(n > 0 ? badgeIcon : null, n > 0 ? `${n} waiting` : '');
  if (n > lastBadge && !win.isFocused()) win.flashFrame(true);
  lastBadge = n;
});

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const r = routeFromArgs(argv);
  if (r) win.webContents.send('route', r);
});

app.whenReady().then(() => {
  // Start-menu / taskbar right-click shortcuts
  if (process.platform === 'win32') {
    app.setUserTasks([
      { program: process.execPath, arguments: '--route=/attendance', title: 'Take register', description: 'Open today’s register', iconPath: process.execPath, iconIndex: 0 },
      { program: process.execPath, arguments: '--route=/gradebook', title: 'Gradebook', description: 'Enter marks', iconPath: process.execPath, iconIndex: 0 },
      { program: process.execPath, arguments: '--route=/finance', title: 'Record a payment', description: 'Fees and receipts', iconPath: process.execPath, iconIndex: 0 },
      { program: process.execPath, arguments: '--route=/students', title: 'Students', description: 'Find or enrol a learner', iconPath: process.execPath, iconIndex: 0 },
    ]);
  }
  // Keyboard shortcuts (menu stays hidden, like most modern Windows apps)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'App', submenu: [
      { label: 'Reload', accelerator: 'F5', click: () => win && win.webContents.reload() },
      { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() },
      { role: 'togglefullscreen', accelerator: 'F11' },
      { role: 'quit', label: 'Exit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  createSplash();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
void Notification;
