const { app, BrowserWindow, session, ipcMain, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

// Разрешаем захват экрана в Chromium
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
// Автоподтверждение диалога доступа к экрану/камере
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
// Включаем логирование Chromium/Electron в консоль
app.commandLine.appendSwitch('enable-logging');

const URL_TO_LOAD = 'https://crm.brullov.com/app/rms-panel/room/test/1/';
const CAPTURE_WINDOW_TITLE = 'Мой рабочий стол';
const SHOW_CAPTURE_PREVIEW = false;
// Автовыбор окна для шаринга (ставим после объявления)
app.commandLine.appendSwitch('auto-select-desktop-capture-source', CAPTURE_WINDOW_TITLE);
const PREFERRED_CAMERA_LABEL = 'A4tech FHD 1080P PC Camera';
let captureSourceIdPromise = null;
const LOG_PATH = path.join(__dirname, 'debug.log');

function logToFile(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch (_) {}
}

function injectPreferredCamera(webContents) {
  const label = JSON.stringify(PREFERRED_CAMERA_LABEL);
  const script = `
    (function() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      const preferredLabel = ${label};
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getUserMedia = async function(constraints = {}) {
        try {
          const prefer = async () => {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            const match = videoDevices.find(d => d.label && d.label.toLowerCase().includes(preferredLabel.toLowerCase()));
            return match ? match.deviceId : null;
          };

          const wantsVideo = constraints === true || constraints.video;
          const videoConstraints = wantsVideo && typeof constraints === 'object' ? constraints.video : null;
          const usesDesktopCapture = !!(
            videoConstraints &&
            typeof videoConstraints === 'object' &&
            (
              videoConstraints.mandatory?.chromeMediaSource === 'desktop' ||
              videoConstraints.chromeMediaSource === 'desktop'
            )
          );

          if (usesDesktopCapture) {
            return await originalGetUserMedia(constraints);
          }

          if (window.__vkcDisplayMediaOverride) {
            return await originalGetUserMedia(constraints);
          }

          if (wantsVideo) {
            const deviceId = await prefer();
            if (deviceId) {
              const merged = { ...constraints, video: { deviceId: { exact: deviceId } } };
              return await originalGetUserMedia(merged);
            }
          }

          const stream = await originalGetUserMedia(constraints);

          if (wantsVideo) {
            try {
              const deviceId = await prefer();
              if (deviceId) {
                stream.getTracks().forEach(t => t.stop());
                const merged = { ...constraints, video: { deviceId: { exact: deviceId } } };
                return await originalGetUserMedia(merged);
              }
            } catch (_) {}
          }

          return stream;
        } catch (err) {
          return originalGetUserMedia(constraints);
        }
      };
    })();
  `;
  webContents.executeJavaScript(script, true);
}

async function getExactCaptureSourceId() {
  if (captureSourceIdPromise) {
    const id = await captureSourceIdPromise;
    if (id) return id;
  }
  return null;
}

function createWindow() {
  const captureWin = new BrowserWindow({
    width: SHOW_CAPTURE_PREVIEW ? 960 : 1280,
    height: SHOW_CAPTURE_PREVIEW ? 540 : 720,
    x: SHOW_CAPTURE_PREVIEW ? 80 : undefined,
    y: SHOW_CAPTURE_PREVIEW ? 80 : undefined,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreen: !SHOW_CAPTURE_PREVIEW,
    frame: SHOW_CAPTURE_PREVIEW,
    skipTaskbar: !SHOW_CAPTURE_PREVIEW,
    focusable: SHOW_CAPTURE_PREVIEW,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  captureWin.setTitle(CAPTURE_WINDOW_TITLE);
  captureWin.loadFile('capture.html');
  captureWin.setAlwaysOnTop(SHOW_CAPTURE_PREVIEW);
  captureWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (SHOW_CAPTURE_PREVIEW) {
    captureWin.show();
    captureWin.focus();
    captureWin.setIgnoreMouseEvents(false);
  } else {
    captureWin.showInactive();
    captureWin.setIgnoreMouseEvents(true);
  }
  captureWin.webContents.on('console-message', (event, level, message) => {
    logToFile('Capture console:', message);
  });
  captureWin.webContents.on('did-finish-load', () => {
    if (typeof captureWin.getMediaSourceId === 'function') {
      const idOrPromise = captureWin.getMediaSourceId();
      captureSourceIdPromise = Promise.resolve(idOrPromise)
        .then(id => {
          logToFile('Capture window mediaSourceId:', id);
          return id;
        })
        .catch(err => {
          logToFile('Capture window mediaSourceId error:', String(err));
          return null;
        });
    }
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreen: true,
    kiosk: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: __dirname + '/main-preload.js',
    },
  });

  const controlWin = new BrowserWindow({
    width: 220,
    height: 60,
    x: 20,
    y: 20,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    parent: win,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: __dirname + '/control-preload.js',
    },
  });

  controlWin.loadFile('control.html');

  // Маскируем под обычный Chrome, чтобы сервисы не считали WebView устаревшим
  win.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );

  win.loadURL(URL_TO_LOAD);

  win.webContents.on('dom-ready', () => {
    injectPreferredCamera(win.webContents);
    const overrideDisplayMedia = `
      (function() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return;
        const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        const excludedLabel = ${JSON.stringify(PREFERRED_CAMERA_LABEL.toLowerCase())};
        const captureKeywords = ['usb', 'hdmi', 'capture', 'video', 'ms2109', 'macrosilicon'];
        navigator.mediaDevices.getDisplayMedia = async function(constraints) {
          try {
            const probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            const probeTrack = probeStream.getVideoTracks()[0];
            const probeSettings = probeTrack ? probeTrack.getSettings() : {};
            const probeDeviceId = probeSettings.deviceId || null;

            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            const captureDevice = videoDevices.find(d => {
              const label = (d.label || '').toLowerCase();
              return label &&
                d.deviceId !== probeDeviceId &&
                !label.includes(excludedLabel) &&
                captureKeywords.some(keyword => label.includes(keyword));
            }) || videoDevices.find(d => {
              const label = (d.label || '').toLowerCase();
              return label &&
                d.deviceId !== probeDeviceId &&
                !label.includes(excludedLabel);
            });

            probeStream.getTracks().forEach(t => t.stop());

            if (captureDevice) {
              console.log('DisplayMedia using capture device:', captureDevice.label);
              window.__vkcDisplayMediaOverride = true;
              try {
                return await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: { deviceId: { exact: captureDevice.deviceId } }
                });
              } finally {
                window.__vkcDisplayMediaOverride = false;
              }
            }

            const id = await window.electronAPI?.getCaptureSourceId();
            if (id) {
              console.log('DisplayMedia falling back to capture window:', id);
              return await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: id
                  }
                }
              });
            }
          } catch (e) {}
          return original(constraints);
        };
      })();
    `;
    win.webContents.executeJavaScript(overrideDisplayMedia, true);
  });

  // Все внешние переходы (в т.ч. target="_blank") открываем в этом же окне
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.loadURL(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url && url !== win.webContents.getURL()) {
      event.preventDefault();
      win.loadURL(url);
    }
  });

  ipcMain.on('go-home', () => {
    win.loadURL(URL_TO_LOAD);
  });
}

app.whenReady().then(() => {
  ipcMain.handle('get-capture-source-id', async () => {
    const id = await getExactCaptureSourceId();
    logToFile('IPC captureSourceId:', id);
    return id;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') return callback(true);
    return callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'display-capture') return true;
    return false;
  });

  // Автовыбор источника для демонстрации экрана (окно "Мой рабочий стол")
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        fetchWindowIcons: false,
      });

      logToFile('Display sources:', sources.map(s => ({ id: s.id, name: s.name })));

      let preferred = null;
      const captureId = await getExactCaptureSourceId();
      logToFile('Using captureId:', captureId);
      if (captureId) {
        preferred = sources.find(src => src.id === captureId);
      }

      if (!preferred) {
        preferred = sources.find(src => src.name === CAPTURE_WINDOW_TITLE);
      }
      if (preferred) {
        logToFile('Selected source:', { id: preferred.id, name: preferred.name });
        return callback({ video: preferred, audio: null });
      }

      logToFile('Preferred capture window not found in available sources');
    } catch (err) {
      logToFile('Display media handler error:', String(err));
    }

    callback({ video: null, audio: null });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
