// Tells the web app it is running inside the Windows app (hides "Install app" buttons).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('musaDesktop', { platform: process.platform, version: process.env.npm_package_version || '1.0.0' });
