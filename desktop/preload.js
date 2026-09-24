// Bridge between the Musa OS web app and Windows (title bar colours, taskbar badge,
// Start-menu shortcuts). Only these small, safe functions are exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musaDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('app-version'),
  setTitleBarColors: (c) => ipcRenderer.send('titlebar', { color: String(c.color), symbolColor: String(c.symbolColor) }),
  setBadge: (n) => ipcRenderer.send('badge', Number(n) || 0),
  onRoute: (cb) => ipcRenderer.on('route', (_e, r) => cb(String(r))),
});
