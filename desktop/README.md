# Musa OS for Windows

A small Electron shell around the live Musa OS site. It opens in its own window with a
taskbar icon, Start-menu entry and desktop shortcut. Because it loads the website, every
push to Vercel updates the app automatically — no new installer needed.

Offline: after the first successful start the app shell is cached (service worker) and the
school's records are kept on the computer (Firestore offline cache). Changes made offline
sync by themselves when the internet returns.

## Change the site address
Edit `config.json` → `appUrl` (for example your own domain), then rebuild.

## Run / build (on Windows)
```
cd desktop
npm install
npm start          # try it
npm run build      # makes release/MusaOS-Setup-1.0.0.exe
```
Upload the .exe somewhere public (GitHub Releases works well) and set
`VITE_DESKTOP_DOWNLOAD_URL` in Vercel to that link — the website then shows
“Download for Windows”.
