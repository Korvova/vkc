const { app, BrowserWindow, BrowserView, session, ipcMain, desktopCapturer, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');

// Разрешаем захват экрана в Chromium
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
// Включаем логирование Chromium/Electron в консоль
app.commandLine.appendSwitch('enable-logging');

const URL_TO_LOAD = 'https://crm.brullov.com/app/rms-panel/room/test/1/';
const MTS_MEETING_URL = 'https://my.mts-link.ru/j/118241477/17695333414';
const TELEMOST_URL = 'https://telemost.yandex.ru/j/66811954592105?source=tab-mail';
const MODERN_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const CAPTURE_WINDOW_TITLE = 'Мой рабочий стол';
const SHOW_CAPTURE_PREVIEW = false;
const SHOW_SHARE_TEST_WINDOW = false;
const PREFER_TAB_LIKE_SHARE = false;
const PREFERRED_CAMERA_LABEL = 'A4tech FHD 1080P PC Camera';
const SHARE_OVERLAY_TITLE = 'Предпросмотр трансляции';
const CAPTURE_PREVIEW_WIDTH = 1920;
const CAPTURE_PREVIEW_HEIGHT = 1080;
const CAPTURE_BOTTOM_GAP = 72;
const CAPTURE_WINDOW_OPACITY_DEFAULT = 1.0;
let captureWindowOpacity = CAPTURE_WINDOW_OPACITY_DEFAULT;
let captureSourceIdPromise = null;
let captureWinRef = null;
let mainWinRef = null;
let controlWinRef = null;
let shareTestWinRef = null;
let shareOverlayWinRef = null;
let scheduleViewRef = null;
let captureTabViewRef = null;
let joinWidgetViewRef = null;
let activeMainTab = 'schedule';
let lastActiveVksTab = 'schedule';
let wasMainKioskBeforePicker = null;
let wasMainFullscreenBeforePicker = null;
let forceTabAudioShare = true;
const LOG_PATH = path.join(__dirname, 'debug.log');
const FORCE_EXTERNAL_MTS_LINK = false;
const ENABLE_MTS_TAB_CAPTURE_EXPERIMENT = false;
const USE_CUSTOM_SHARE_HANDLER = true;

function getScheduleWebContents() {
  if (scheduleViewRef && scheduleViewRef.webContents && !scheduleViewRef.webContents.isDestroyed()) {
    return scheduleViewRef.webContents;
  }
  if (mainWinRef && !mainWinRef.isDestroyed() && mainWinRef.webContents && !mainWinRef.webContents.isDestroyed()) {
    return mainWinRef.webContents;
  }
  return null;
}

function buildJoinWidgetDataUrl() {
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Join Widget</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0f172a;
      color: #e2e8f0;
      font: 16px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    .card {
      width: min(760px, 92vw);
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 14px 35px rgba(0,0,0,.35);
    }
    .row { margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
    .btn {
      border: 0;
      border-radius: 10px;
      padding: 12px 16px;
      background: #0b57d0;
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .btn.secondary { background: #334155; }
    .url {
      margin-top: 10px;
      word-break: break-all;
      font-size: 13px;
      opacity: .9;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin:0 0 8px 0;">Виджет подключения</h2>
    <div>Кнопки кликабельные, без парсинга расписания.</div>
    <div class="row">
      <a id="joinMtsBtn" class="btn" href="${MTS_MEETING_URL}" target="_self" rel="noopener noreferrer">Открыть МТС Линк</a>
      <a id="joinTelemostBtn" class="btn" href="${TELEMOST_URL}" target="_self" rel="noopener noreferrer">Открыть Телемост</a>
      <button id="copyBtn" class="btn secondary">Скопировать ссылку</button>
    </div>
    <div class="url">MTS: <span id="meetingUrl">${MTS_MEETING_URL}</span></div>
    <div class="url">Telemost: <span id="telemostUrl">${TELEMOST_URL}</span></div>
  </div>
  <script>
    const mtsUrl = document.getElementById('meetingUrl').textContent.trim();
    const telemostUrl = document.getElementById('telemostUrl').textContent.trim();
    document.getElementById('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('MTS: ' + mtsUrl + '\\nTelemost: ' + telemostUrl);
        document.getElementById('copyBtn').textContent = 'Скопировано';
        setTimeout(() => document.getElementById('copyBtn').textContent = 'Скопировать ссылку', 1000);
      } catch (_) {}
    });
  </script>
</body>
</html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function logToFile(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch (_) {}
}

function isMtsLinkUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)mts-link\.ru$/i.test(parsed.hostname);
  } catch (_) {
    return false;
  }
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

function injectJoinButtonFromEventLink(webContents) {
  const script = `
    (function() {
      const BUTTON_CLASS = 'btn-telemost';
      const BUTTON_ID = 'vkc-join-button-global';
      const URL_PATTERN = /(?:https?:\\/\\/)?(?:my\\.)?mts-link\\.ru\\/j\\/[\\w-]+\\/[\\w-]+(?:\\/[\\w-]+\\/[\\w-]+)?/i;
      const CONTAINER_SELECTORS = [
        '.current-event',
        '.event',
        '.event-card',
        '.schedule-item',
        '.meeting-item',
        '[data-testid*="event"]',
        '[data-testid*="schedule"]'
      ];

      function normalizeUrl(rawUrl) {
        if (!rawUrl) return null;
        const trimmed = rawUrl.replace(/[),.;!?]+$/, '');
        if (/^https?:\\/\\//i.test(trimmed)) return trimmed;
        if (/^(?:my\\.)?mts-link\\.ru\\//i.test(trimmed)) return 'https://' + trimmed;
        return trimmed;
      }

      function getEventLink(container) {
        if (!container) return null;
        // 1) Явные ссылки в DOM.
        const anchor =
          container.querySelector('a[href*="mts-link.ru/j/"]') ||
          container.querySelector('a[href*="webinar.ru"]');
        if (anchor && anchor.href) return normalizeUrl(anchor.href);

        // 2) Ссылки в data-* атрибутах.
        const attrs = ['data-link', 'data-url', 'data-href', 'data-meeting-url'];
        for (const attr of attrs) {
          const value = container.getAttribute(attr);
          if (value) {
            const m = String(value).match(URL_PATTERN);
            if (m) return normalizeUrl(m[0]);
          }
        }

        // 3) Любой текст внутри карточки события.
        const sourceText = container.innerText || container.textContent || '';
        const match = String(sourceText).match(URL_PATTERN);
        return match ? normalizeUrl(match[0]) : null;
      }

      function getFirstPageLink() {
        try {
          const bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
          const match = String(bodyText).match(URL_PATTERN);
          return match ? normalizeUrl(match[0]) : null;
        } catch (_) {
          return null;
        }
      }

      function getCandidateContainers() {
        const list = [];
        const seen = new Set();
        for (const selector of CONTAINER_SELECTORS) {
          const nodes = document.querySelectorAll(selector);
          nodes.forEach((node) => {
            if (!node || seen.has(node)) return;
            seen.add(node);
            list.push(node);
          });
        }
        if (list.length) return list;

        // Fallback: пробуем крупные смысловые блоки на странице.
        const fallbackNodes = document.querySelectorAll('main, section, article, [role="main"], .content, .wrapper');
        fallbackNodes.forEach((node) => {
          if (!node || seen.has(node)) return;
          seen.add(node);
          list.push(node);
        });
        return list;
      }

      function ensureButton(container) {
        if (!container) return;

        const existingButton = container.querySelector('.' + BUTTON_CLASS);
        if (existingButton && existingButton.href) {
          existingButton.target = '_self';
          existingButton.rel = 'noopener noreferrer';
          return;
        }

        const link = getEventLink(container);
        const injectedButton = container.querySelector('#' + BUTTON_ID);

        if (!link) {
          if (injectedButton) injectedButton.remove();
          return;
        }

        if (injectedButton) {
          injectedButton.href = link;
          return;
        }

        const button = document.createElement('a');
        button.className = BUTTON_CLASS;
        button.href = link;
        button.target = '_self';
        button.rel = 'noopener noreferrer';
        button.textContent = 'Подключиться к созвону';
        container.insertBefore(button, container.querySelector('.details') || null);
      }

      function ensureGlobalButton(link) {
        const current = document.getElementById(BUTTON_ID);
        if (!link) {
          if (current) current.remove();
          return;
        }
        if (current) {
          current.href = link;
          return;
        }

        const button = document.createElement('a');
        button.id = BUTTON_ID;
        button.className = BUTTON_CLASS;
        button.href = link;
        button.target = '_self';
        button.rel = 'noopener noreferrer';
        button.textContent = 'Подключиться к созвону';
        button.style.position = 'fixed';
        button.style.top = '12px';
        button.style.right = '12px';
        button.style.zIndex = '2147483647';
        button.style.background = '#0b57d0';
        button.style.color = '#fff';
        button.style.padding = '10px 14px';
        button.style.borderRadius = '8px';
        button.style.font = '600 14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        button.style.textDecoration = 'none';
        button.style.boxShadow = '0 6px 18px rgba(0,0,0,.25)';
        document.body.appendChild(button);
      }

      function updateButtons() {
        const containers = getCandidateContainers();
        let bestLink = null;
        for (const container of containers) {
          try {
            const link = getEventLink(container);
            if (link && !bestLink) bestLink = link;
            ensureButton(container);
          } catch (_) {}
        }
        if (!bestLink) bestLink = getFirstPageLink();
        ensureGlobalButton(bestLink);
        try {
          console.log('VKC join-link parser:', JSON.stringify({
            containers: containers.length,
            foundLink: bestLink || null
          }));
        } catch (_) {}
      }

      updateButtons();

      const observer = new MutationObserver(() => updateButtons());
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    })();
  `;
  webContents.executeJavaScript(script, true);
}

function injectShareLifecycleBridge(webContents) {
  const script = `
    (function() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return;
      if (window.__vkcShareLifecycleInstalled) return;
      window.__vkcShareLifecycleInstalled = true;
      const useCustomShareHandler = ${USE_CUSTOM_SHARE_HANDLER ? 'true' : 'false'};
      window.__vkcDisplayStreams = new Set();
      window.__vkcShareState = {
        screenShareId: null,
        peerCloseUrl: null,
      };

      const parseShareHintsFromUrl = (rawUrl) => {
        try {
          const url = String(rawUrl || '');
          const idMatch = url.match(/\\/api\\/screensharings\\/(\\d+)/i);
          if (idMatch && idMatch[1]) {
            window.__vkcShareState.screenShareId = idMatch[1];
          }
          if (/\\/rtc\\/peer\\/.+\\/close(?:\\?|$)/i.test(url)) {
            window.__vkcShareState.peerCloseUrl = url;
          }
        } catch (_) {}
      };

      const patchNetworkTracking = () => {
        try {
          if (!window.fetch.__vkcPatched) {
            const originalFetch = window.fetch.bind(window);
            const wrappedFetch = async function(input, init) {
              try {
                const url = (typeof input === 'string') ? input : (input && input.url) || '';
                parseShareHintsFromUrl(url);
              } catch (_) {}
              const response = await originalFetch(input, init);
              try {
                const url = (typeof input === 'string') ? input : (input && input.url) || '';
                if (/\\/api\\/screensharings(?:\\?|$|\\/)/i.test(url)) {
                  const clone = response.clone();
                  clone.json().then((data) => {
                    try {
                      const id = data && (data.id || data.screensharing_id || data.screenSharingId);
                      if (id) window.__vkcShareState.screenShareId = String(id);
                    } catch (_) {}
                  }).catch(() => {});
                }
              } catch (_) {}
              return response;
            };
            wrappedFetch.__vkcPatched = true;
            window.fetch = wrappedFetch;
          }
        } catch (_) {}

        try {
          if (window.XMLHttpRequest && !window.XMLHttpRequest.prototype.__vkcPatched) {
            const origOpen = window.XMLHttpRequest.prototype.open;
            const origSend = window.XMLHttpRequest.prototype.send;
            window.XMLHttpRequest.prototype.open = function(method, url) {
              try {
                this.__vkcMethod = method;
                this.__vkcUrl = url;
                parseShareHintsFromUrl(url);
              } catch (_) {}
              return origOpen.apply(this, arguments);
            };
            window.XMLHttpRequest.prototype.send = function() {
              try {
                this.addEventListener('load', () => {
                  try {
                    parseShareHintsFromUrl(this.__vkcUrl || '');
                    if (/\\/api\\/screensharings(?:\\?|$|\\/)/i.test(String(this.__vkcUrl || ''))) {
                      const txt = this.responseText;
                      if (txt) {
                        const data = JSON.parse(txt);
                        const id = data && (data.id || data.screensharing_id || data.screenSharingId);
                        if (id) window.__vkcShareState.screenShareId = String(id);
                      }
                    }
                  } catch (_) {}
                });
              } catch (_) {}
              return origSend.apply(this, arguments);
            };
            window.XMLHttpRequest.prototype.__vkcPatched = true;
          }
        } catch (_) {}
      };

      patchNetworkTracking();

      window.__vkcApiStopShare = async function() {
        const state = window.__vkcShareState || {};
        const tasks = [];

        try {
          if (state.peerCloseUrl) {
            tasks.push(
              fetch(state.peerCloseUrl, {
                method: 'POST',
                credentials: 'include',
                mode: 'cors',
                keepalive: true,
              }).catch(() => {})
            );
          }
        } catch (_) {}

        try {
          if (state.screenShareId) {
            const delUrl = 'https://gw.mts-link.ru/api/screensharings/' + encodeURIComponent(String(state.screenShareId));
            tasks.push(
              fetch(delUrl, {
                method: 'DELETE',
                credentials: 'include',
                mode: 'cors',
                keepalive: true,
              }).catch(() => {})
            );
          }
        } catch (_) {}

        try {
          await Promise.all(tasks);
        } catch (_) {}
      };

      window.__vkcForceStopShare = function() {
        try {
          const streams = Array.from(window.__vkcDisplayStreams || []);
          streams.forEach((s) => {
            try { s.getTracks().forEach(t => t.stop()); } catch (_) {}
          });
          window.__vkcDisplayStreams = new Set();
        } catch (_) {}
        try {
          const aux = Array.from(window.__vkcAuxAudioStreams || []);
          aux.forEach((s) => {
            try { s.getTracks().forEach(t => t.stop()); } catch (_) {}
          });
          window.__vkcAuxAudioStreams = new Set();
        } catch (_) {}
        try {
          const stream = window.__vkcLastDisplayStream;
          if (stream && stream.getTracks) {
            stream.getTracks().forEach(t => t.stop());
          }
          window.__vkcLastDisplayStream = null;
        } catch (_) {}
        try {
          window.electronAPI?.setShareActive?.(false);
        } catch (_) {}
      };

      const pickPreferredShareAudioInput = async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter(d => d.kind === 'audioinput');
          const strong = ['usb3.0 capture digital audio', 'capture digital audio'];
          const soft = ['capture', 'digital', 'hdmi', 'usb'];
          const sorted = audioInputs
            .map((d) => {
              const label = (d.label || '').toLowerCase();
              if (!label) return { device: d, score: -1 };
              if (label.includes('a4tech') || label.includes('pc camera')) return { device: d, score: -1 };
              if (strong.some((k) => label.includes(k))) return { device: d, score: 100 };
              let score = 0;
              if (label.includes('capture')) score += 35;
              if (label.includes('digital')) score += 30;
              if (label.includes('hdmi')) score += 20;
              if (label.includes('usb')) score += 10;
              if (soft.some((k) => label.includes(k))) score += 5;
              return { device: d, score };
            })
            .filter((x) => x.score >= 0)
            .sort((a, b) => b.score - a.score);
          return sorted.length ? sorted[0].device : null;
        } catch (_) {
          return null;
        }
      };

      const ensureShareAudioTrack = async (stream, constraints) => {
        try {
          if (!stream || !stream.addTrack || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
          const requestedAudio = !!(
            constraints &&
            ((typeof constraints === 'object' && constraints.audio) || constraints === true)
          );
          if (!requestedAudio) return;

          const preferredInput = await pickPreferredShareAudioInput();
          const audioConstraint = preferredInput
            ? {
                deviceId: { exact: preferredInput.deviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              }
            : true;

          let audioStream = null;
          try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
          } catch (_) {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          }
          const audioTrack = audioStream && audioStream.getAudioTracks ? audioStream.getAudioTracks()[0] : null;
          if (!audioTrack) {
            try { audioStream && audioStream.getTracks && audioStream.getTracks().forEach(t => t.stop()); } catch (_) {}
            return;
          }
          const existingAudioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
          existingAudioTracks.forEach((t) => {
            try { if (stream.removeTrack) stream.removeTrack(t); } catch (_) {}
            try { t.stop(); } catch (_) {}
          });
          stream.addTrack(audioTrack);
          if (!window.__vkcAuxAudioStreams) window.__vkcAuxAudioStreams = new Set();
          window.__vkcAuxAudioStreams.add(audioStream);
          audioTrack.addEventListener('ended', () => {
            try {
              if (window.__vkcAuxAudioStreams) window.__vkcAuxAudioStreams.delete(audioStream);
              audioStream.getTracks().forEach(t => t.stop());
            } catch (_) {}
          }, { once: true });
          try {
            console.log('VKC share audio fallback attached:', JSON.stringify({
              deviceLabel: preferredInput ? preferredInput.label : null,
              deviceId: preferredInput ? preferredInput.deviceId : null,
              replacedTracks: existingAudioTracks.length
            }));
          } catch (_) {}
        } catch (err) {
          try { console.log('VKC share audio fallback error:', String(err)); } catch (_) {}
        }
      };

      const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async function(constraints) {
        if (useCustomShareHandler) {
          try {
            window.electronAPI?.setSharePickerActive?.(true);
          } catch (_) {}
        }
        try {
          console.log('VKC share request constraints:', JSON.stringify(constraints || {}));
        } catch (_) {}
        let stream;
        try {
          stream = await original(constraints);
        } finally {
          if (useCustomShareHandler) {
            try {
              window.electronAPI?.setSharePickerActive?.(false);
            } catch (_) {}
          }
        }
        window.__vkcLastDisplayStream = stream;
        try { window.__vkcDisplayStreams.add(stream); } catch (_) {}
        try {
          window.electronAPI?.setShareActive?.(true);
        } catch (_) {}

        try {
          const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
          const settings = track && track.getSettings ? track.getSettings() : {};
          const displaySurface = settings && settings.displaySurface ? settings.displaySurface : '';
          console.log('VKC share stream info:', JSON.stringify({
            trackLabel: track ? track.label : '',
            displaySurface,
            settings
          }));
        } catch (_) {}

        await ensureShareAudioTrack(stream, constraints);

        const notifyStopped = () => {
          try {
            const hasLiveTracks = stream.getTracks().some(t => t.readyState === 'live');
            if (!hasLiveTracks) {
              try {
                const aux = Array.from(window.__vkcAuxAudioStreams || []);
                aux.forEach((s) => {
                  try { s.getTracks().forEach(t => t.stop()); } catch (_) {}
                });
                window.__vkcAuxAudioStreams = new Set();
              } catch (_) {}
              try { window.__vkcDisplayStreams.delete(stream); } catch (_) {}
              window.__vkcLastDisplayStream = null;
              window.electronAPI?.setShareActive?.(false);
            }
          } catch (_) {}
        };

        stream.getTracks().forEach(track => {
          track.addEventListener('ended', notifyStopped, { once: false });
        });

        return stream;
      };
    })();
  `;
  webContents.executeJavaScript(script, true);
}

async function getExactCaptureSourceId() {
  if (captureWinRef && !captureWinRef.isDestroyed() && typeof captureWinRef.getMediaSourceId === 'function') {
    try {
      const id = await Promise.resolve(captureWinRef.getMediaSourceId());
      if (id) return id;
    } catch (err) {
      logToFile('getExactCaptureSourceId direct error:', String(err));
    }
  }

  if (captureSourceIdPromise) {
    const id = await captureSourceIdPromise;
    if (id) return id;
  }
  return null;
}

function getWindowMediaSourceIdSync(win) {
  if (!win || win.isDestroyed() || typeof win.getMediaSourceId !== 'function') return null;
  try {
    return win.getMediaSourceId();
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function layoutCaptureWindowForShare() {
  if (!captureWinRef || captureWinRef.isDestroyed()) return;
  if (SHOW_CAPTURE_PREVIEW) return;
  try {
    const area = screen.getPrimaryDisplay().workArea;
    const height = Math.max(240, area.height - CAPTURE_BOTTOM_GAP);
    captureWinRef.setFullScreen(false);
    captureWinRef.setBounds({
      x: area.x,
      y: area.y,
      width: area.width,
      height,
    });
  } catch (err) {
    logToFile('layoutCaptureWindowForShare error:', String(err));
  }
}

function closeShareOverlayWindow() {
  if (shareOverlayWinRef && !shareOverlayWinRef.isDestroyed()) {
    shareOverlayWinRef.close();
  }
  shareOverlayWinRef = null;
}

function stopShareInMainWindow() {
  const scheduleWC = getScheduleWebContents();
  if (!scheduleWC || scheduleWC.isDestroyed()) return;
  scheduleWC.executeJavaScript(
    `(function() {
      try {
        try {
          if (typeof window.__vkcApiStopShare === 'function') {
            window.__vkcApiStopShare().catch(() => {});
          }
        } catch (_) {}

        const stopStream = (stream) => {
          try {
            if (stream && stream.getTracks) {
              stream.getTracks().forEach((t) => {
                try { t.stop(); } catch (_) {}
              });
            }
          } catch (_) {}
        };

        if (typeof window.__vkcForceStopShare === 'function') {
          window.__vkcForceStopShare();
          return;
        }
        const allStreams = Array.from(window.__vkcDisplayStreams || []);
        allStreams.forEach((s) => {
          stopStream(s);
        });
        const stream = window.__vkcLastDisplayStream;
        stopStream(stream);

        try {
          const mediaNodes = document.querySelectorAll('video, audio');
          mediaNodes.forEach((el) => {
            const s = el && el.srcObject;
            if (!s || !s.getTracks) return;
            const videoTracks = s.getVideoTracks ? s.getVideoTracks() : [];
            const hasDisplayTrack = videoTracks.some((t) => {
              try {
                const settings = t.getSettings ? t.getSettings() : {};
                return !!settings.displaySurface;
              } catch (_) {
                return false;
              }
            });
            if (hasDisplayTrack) {
              stopStream(s);
            }
          });
        } catch (_) {}

        window.__vkcLastDisplayStream = null;
        window.__vkcDisplayStreams = new Set();
        window.electronAPI?.setShareActive?.(false);
      } catch (_) {}
    })();`,
    true
  );
}

function openShareOverlayWindow(source) {
  if (!source || !source.id) return;

  if (!shareOverlayWinRef || shareOverlayWinRef.isDestroyed()) {
    shareOverlayWinRef = new BrowserWindow({
      width: 1920,
      height: 1080,
      autoHideMenuBar: true,
      frame: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      fullscreenable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'share-overlay-preload.js'),
      },
    });
    shareOverlayWinRef.on('closed', () => {
      shareOverlayWinRef = null;
    });
    shareOverlayWinRef.on('blur', () => {
      if (shareOverlayWinRef && !shareOverlayWinRef.isDestroyed()) {
        shareOverlayWinRef.setAlwaysOnTop(true, 'screen-saver');
        if (typeof shareOverlayWinRef.moveTop === 'function') shareOverlayWinRef.moveTop();
      }
    });
  }

  shareOverlayWinRef.setTitle(`${SHARE_OVERLAY_TITLE}: ${source.name || source.id}`);
  const overlayUrl =
    'file://' +
    path.join(__dirname, 'share-overlay.html').replace(/\\/g, '/') +
    '#' +
    encodeURIComponent(source.id);
  shareOverlayWinRef.loadURL(overlayUrl);
  shareOverlayWinRef.setAlwaysOnTop(true, 'screen-saver');
  shareOverlayWinRef.setFullScreen(false);
  shareOverlayWinRef.unmaximize();

  const workArea = screen.getPrimaryDisplay().workArea;
  const panelWidth = 430;
  const panelHeight = 62;
  const panelX = Math.round(workArea.x + (workArea.width - panelWidth) / 2);
  const panelY = workArea.y + 16;
  shareOverlayWinRef.setBounds({ x: panelX, y: panelY, width: panelWidth, height: panelHeight });
  shareOverlayWinRef.showInactive();
}

function bringCaptureWindowToFront() {
  if (!captureWinRef || captureWinRef.isDestroyed()) return;
  try {
    captureWinRef.setOpacity(1);
    captureWindowOpacity = 1;
    if (SHOW_CAPTURE_PREVIEW) {
      captureWinRef.setFullScreen(false);
      captureWinRef.unmaximize();
    } else {
      layoutCaptureWindowForShare();
    }
    captureWinRef.setAlwaysOnTop(false);
    if (!captureWinRef.isVisible()) captureWinRef.showInactive();
    if (typeof captureWinRef.moveTop === 'function') captureWinRef.moveTop();
    captureWinRef.showInactive();
    logToFile('Capture window moved to front for share');
  } catch (err) {
    logToFile('Capture window moveTop error:', String(err));
  }
}

function hideCaptureWindowAfterShare() {
  if (!captureWinRef || captureWinRef.isDestroyed()) return;
  try {
    captureWinRef.setAlwaysOnTop(false);
    captureWinRef.hide();
    logToFile('Capture window hidden after share stop');
  } catch (err) {
    logToFile('Capture window hide error:', String(err));
  }
}

function setCaptureWindowOpacity(opacity) {
  const num = Number(opacity);
  if (!Number.isFinite(num)) return;
  const clamped = Math.max(0, Math.min(1, num));
  captureWindowOpacity = clamped;
  if (captureWinRef && !captureWinRef.isDestroyed()) {
    captureWinRef.setOpacity(clamped);
  }
  logToFile('Capture window opacity set:', clamped);
}

function setViewBounds() {
  if (!mainWinRef || mainWinRef.isDestroyed()) return;
  const [width, height] = mainWinRef.getContentSize();
  const topInset = 0;
  const bounds = { x: 0, y: topInset, width, height: Math.max(100, height - topInset) };
  try {
    if (scheduleViewRef) scheduleViewRef.setBounds(bounds);
    if (captureTabViewRef) captureTabViewRef.setBounds(bounds);
    if (joinWidgetViewRef) joinWidgetViewRef.setBounds(bounds);
  } catch (_) {}
}

function createCaptureTabView() {
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: __dirname + '/capture-tab-preload.js',
    },
  });
  view.webContents.on('console-message', (event, level, message) => {
    logToFile('CaptureTab console:', message);
  });
  view.webContents.loadFile(path.join('Chrom', 'capture-tab.html'));
  return view;
}

function switchMainTab(tabName) {
  if (!mainWinRef || mainWinRef.isDestroyed()) return;
  const tab = tabName === 'capture' ? 'capture' : (tabName === 'join' ? 'join' : 'schedule');
  activeMainTab = tab;
  if (tab !== 'capture') {
    lastActiveVksTab = tab;
  }

  try {
    mainWinRef.removeBrowserView(scheduleViewRef);
  } catch (_) {}
  try {
    mainWinRef.removeBrowserView(captureTabViewRef);
  } catch (_) {}
  try {
    mainWinRef.removeBrowserView(joinWidgetViewRef);
  } catch (_) {}

  const view = tab === 'capture'
    ? captureTabViewRef
    : (tab === 'join' ? joinWidgetViewRef : scheduleViewRef);
  if (view) {
    mainWinRef.addBrowserView(view);
    setViewBounds();
    try { view.webContents.focus(); } catch (_) {}
  }
  logToFile('Main tab switched:', tab);
}

function createWindow() {
  const captureWin = new BrowserWindow({
    width: SHOW_CAPTURE_PREVIEW ? CAPTURE_PREVIEW_WIDTH : 1280,
    height: SHOW_CAPTURE_PREVIEW ? CAPTURE_PREVIEW_HEIGHT : 720,
    x: SHOW_CAPTURE_PREVIEW ? 80 : undefined,
    y: SHOW_CAPTURE_PREVIEW ? 80 : undefined,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreen: false,
    frame: SHOW_CAPTURE_PREVIEW,
    skipTaskbar: !SHOW_CAPTURE_PREVIEW,
    focusable: SHOW_CAPTURE_PREVIEW,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  captureWinRef = captureWin;

  captureWin.setTitle(CAPTURE_WINDOW_TITLE);
  captureWin.loadFile('capture.html');
  captureWin.setOpacity(captureWindowOpacity);
  captureWin.setAlwaysOnTop(false);
  captureWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  layoutCaptureWindowForShare();
  if (SHOW_CAPTURE_PREVIEW) {
    captureWin.showInactive();
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

  if (SHOW_SHARE_TEST_WINDOW) {
    const shareTestWin = new BrowserWindow({
      width: 960,
      height: 540,
      x: 40,
      y: 640,
      autoHideMenuBar: true,
      frame: true,
      show: true,
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    shareTestWinRef = shareTestWin;
    shareTestWin.setTitle('Вкладка для демонстрации');
    shareTestWin.loadURL(
      'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        '<!doctype html><html><head><meta charset="UTF-8"><title>Вкладка для демонстрации</title>' +
        '<style>body{margin:0;display:grid;place-items:center;height:100vh;background:#000;color:#fff;font:700 36px system-ui;}div{padding:20px 28px;border:2px solid #fff;border-radius:12px;text-align:center;max-width:80vw;}</style>' +
        '</head><body><div>Выбери это окно в демонстрации экрана</div></body></html>'
      )
    );
  } else {
    shareTestWinRef = null;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreen: true,
    kiosk: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: __dirname + '/main-preload.js',
    },
  });
  mainWinRef = win;

  scheduleViewRef = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: __dirname + '/main-preload.js',
    },
  });

  captureTabViewRef = createCaptureTabView();

  joinWidgetViewRef = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  const controlWin = new BrowserWindow({
    width: 760,
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

  controlWinRef = controlWin;
  controlWin.loadFile('control.html');
  try {
    const area = screen.getPrimaryDisplay().workArea;
    controlWin.setPosition(Math.max(area.x + 10, Math.round(area.x + (area.width - 760) / 2)), area.y + 10);
  } catch (_) {}

  // Маскируем под обычный Chrome, чтобы сервисы не считали WebView устаревшим
  scheduleViewRef.webContents.setUserAgent(MODERN_BROWSER_UA);
  joinWidgetViewRef.webContents.setUserAgent(MODERN_BROWSER_UA);
  scheduleViewRef.webContents.on('console-message', (event, level, message) => {
    logToFile('Main console:', message);
  });

  joinWidgetViewRef.webContents.on('console-message', (event, level, message) => {
    logToFile('JoinWidget console:', message);
  });

  scheduleViewRef.webContents.on('dom-ready', () => {
    injectPreferredCamera(scheduleViewRef.webContents);
    injectJoinButtonFromEventLink(scheduleViewRef.webContents);
    injectShareLifecycleBridge(scheduleViewRef.webContents);
  });

  // Все внешние переходы (в т.ч. target="_blank") открываем в этом же окне
  scheduleViewRef.webContents.setWindowOpenHandler(({ url }) => {
    if (FORCE_EXTERNAL_MTS_LINK && !ENABLE_MTS_TAB_CAPTURE_EXPERIMENT && isMtsLinkUrl(url)) {
      shell.openExternal(url);
      logToFile('Opened externally (MTS Link):', url);
      return { action: 'deny' };
    }
    scheduleViewRef.webContents.loadURL(url);
    return { action: 'deny' };
  });

  scheduleViewRef.webContents.on('will-navigate', (event, url) => {
    if (url && url !== scheduleViewRef.webContents.getURL()) {
      if (FORCE_EXTERNAL_MTS_LINK && !ENABLE_MTS_TAB_CAPTURE_EXPERIMENT && isMtsLinkUrl(url)) {
        event.preventDefault();
        shell.openExternal(url);
        logToFile('Navigated externally (MTS Link):', url);
        return;
      }
      event.preventDefault();
      scheduleViewRef.webContents.loadURL(url);
    }
  });

  scheduleViewRef.webContents.loadURL(URL_TO_LOAD);
  joinWidgetViewRef.webContents.loadURL(buildJoinWidgetDataUrl());
  switchMainTab('schedule');
  win.on('resize', setViewBounds);
  win.on('enter-full-screen', () => setTimeout(setViewBounds, 50));
  win.on('leave-full-screen', () => setTimeout(setViewBounds, 50));

  ipcMain.on('go-home', () => {
    if (scheduleViewRef && scheduleViewRef.webContents) {
      scheduleViewRef.webContents.loadURL(URL_TO_LOAD);
    }
    switchMainTab('schedule');
  });

  ipcMain.on('switch-main-tab', (_event, tab) => {
    switchMainTab(tab === 'capture' ? 'capture' : (tab === 'join' ? 'join' : 'schedule'));
  });
  ipcMain.on('set-force-tab-audio', (_event, enabled) => {
    forceTabAudioShare = !!enabled;
    logToFile('Force tab audio changed:', forceTabAudioShare);
  });
  ipcMain.handle('get-force-tab-audio', () => {
    return forceTabAudioShare;
  });

  ipcMain.on('capture-tab-stop-share', () => {
    // Не убиваем поток вручную: закрываем вкладку-источник,
    // Chromium/WebRTC сам завершит шаринг для этой вкладки.
    try {
      if (mainWinRef && !mainWinRef.isDestroyed() && captureTabViewRef) {
        try { mainWinRef.removeBrowserView(captureTabViewRef); } catch (_) {}
      }
      if (captureTabViewRef && captureTabViewRef.webContents && !captureTabViewRef.webContents.isDestroyed()) {
        try { captureTabViewRef.webContents.close({ waitForBeforeUnload: false }); } catch (_) {}
      }
      captureTabViewRef = null;
    } catch (_) {}

    // Возвращаемся в активную вкладку ВКС до перехода в HDMI Capture.
    const returnTab = lastActiveVksTab === 'join' ? 'join' : 'schedule';
    switchMainTab(returnTab);

    // Пересоздаем HDMI вкладку, чтобы была готова для следующего шаринга.
    setTimeout(() => {
      try {
        if (!captureTabViewRef) {
          captureTabViewRef = createCaptureTabView();
          if (activeMainTab === 'capture') {
            switchMainTab('capture');
          } else {
            setViewBounds();
          }
        }
      } catch (err) {
        logToFile('Capture tab recreate error:', String(err));
      }
    }, 120);

    logToFile('Capture tab closed by user; switched to:', returnTab);
  });

  ipcMain.on('close-app', () => {
    closeShareOverlayWindow();
    app.quit();
  });

  ipcMain.on('overlay-back', () => {
    closeShareOverlayWindow();
  });

  ipcMain.on('overlay-stop-share', () => {
    stopShareInMainWindow();
    closeShareOverlayWindow();
    hideCaptureWindowAfterShare();
    if (mainWinRef && !mainWinRef.isDestroyed()) {
      mainWinRef.setAlwaysOnTop(true, 'screen-saver');
      if (typeof mainWinRef.moveTop === 'function') mainWinRef.moveTop();
      mainWinRef.focus();
      setTimeout(() => {
        if (mainWinRef && !mainWinRef.isDestroyed()) {
          mainWinRef.setAlwaysOnTop(false);
        }
      }, 300);
    }
  });

  ipcMain.on('overlay-set-capture-opacity', (event, opacity) => {
    setCaptureWindowOpacity(opacity);
  });

  ipcMain.handle('overlay-get-capture-opacity', () => {
    return captureWindowOpacity;
  });

  ipcMain.on('share-active', (event, active) => {
    logToFile('Share active state:', !!active);
    if (!active) {
      closeShareOverlayWindow();
      hideCaptureWindowAfterShare();
    }
  });

  ipcMain.on('share-picker-active', (event, active) => {
    if (!USE_CUSTOM_SHARE_HANDLER) return;
    const isActive = !!active;
    logToFile('Share picker active:', isActive);
    if (isActive) {
      if (captureWinRef && !captureWinRef.isDestroyed()) {
        try { captureWinRef.hide(); } catch (_) {}
      }
      if (mainWinRef && !mainWinRef.isDestroyed()) {
        try {
          wasMainKioskBeforePicker = !!mainWinRef.isKiosk();
          wasMainFullscreenBeforePicker = !!mainWinRef.isFullScreen();
          if (wasMainKioskBeforePicker) mainWinRef.setKiosk(false);
          if (wasMainFullscreenBeforePicker) mainWinRef.setFullScreen(false);
          mainWinRef.blur();
        } catch (_) {}
      }
      return;
    }

    if (mainWinRef && !mainWinRef.isDestroyed()) {
      try {
        if (wasMainFullscreenBeforePicker) mainWinRef.setFullScreen(true);
        if (wasMainKioskBeforePicker) mainWinRef.setKiosk(true);
      } catch (_) {}
    }
    wasMainKioskBeforePicker = null;
    wasMainFullscreenBeforePicker = null;
  });
}

app.whenReady().then(() => {
  ipcMain.handle('get-capture-source-id', async () => {
    const id = await getExactCaptureSourceId();
    logToFile('IPC captureSourceId:', id);
    return id;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture' || permission === 'notifications') {
      return callback(true);
    }
    return callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'display-capture' || permission === 'notifications') {
      return true;
    }
    return false;
  });

  if (USE_CUSTOM_SHARE_HANDLER) {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    let callbackCalled = false;
    const withTabAudioIfRequested = (payload = {}, frame = null) => {
      if (!frame) return payload;
      if (!forceTabAudioShare && (!request || !request.audioRequested)) return payload;
      return { ...payload, audio: frame };
    };
    const safeCallback = (payload = {}) => {
      if (callbackCalled) {
        logToFile('Display media callback already called, ignoring payload');
        return;
      }
      callbackCalled = true;
      callback(payload);
    };

    try {
      if (captureWinRef && !captureWinRef.isDestroyed() && !captureWinRef.isVisible()) {
        if (SHOW_CAPTURE_PREVIEW) {
          captureWinRef.showInactive();
        } else {
          layoutCaptureWindowForShare();
          captureWinRef.showInactive();
          captureWinRef.setIgnoreMouseEvents(true);
        }
        await sleep(120);
      }

      const scheduleWC = getScheduleWebContents();
      const currentUrl = scheduleWC && !scheduleWC.isDestroyed() ? scheduleWC.getURL() : '';
      logToFile('Display media currentUrl:', currentUrl);

      if (ENABLE_MTS_TAB_CAPTURE_EXPERIMENT && isMtsLinkUrl(currentUrl)) {
        const frame =
          (captureWinRef && !captureWinRef.isDestroyed() && captureWinRef.webContents && captureWinRef.webContents.mainFrame)
            ? captureWinRef.webContents.mainFrame
            : (scheduleWC && !scheduleWC.isDestroyed() ? scheduleWC.mainFrame : null);
        if (frame) {
          const streams = withTabAudioIfRequested({ video: frame }, frame);
          logToFile('Selected source (MTS tab-capture experiment):', {
            url: currentUrl,
            target: frame === (captureWinRef && captureWinRef.webContents ? captureWinRef.webContents.mainFrame : null)
              ? CAPTURE_WINDOW_TITLE
              : 'main-frame',
          });
          return safeCallback(streams);
        }
      }

      if (
        PREFER_TAB_LIKE_SHARE &&
        captureWinRef &&
        !captureWinRef.isDestroyed() &&
        captureWinRef.webContents &&
        captureWinRef.webContents.mainFrame
      ) {
        const frame = captureWinRef.webContents.mainFrame;
        const streams = withTabAudioIfRequested({ video: frame }, frame);
        logToFile('Selected source (tab-like):', { title: CAPTURE_WINDOW_TITLE });
        return safeCallback(streams);
      }

      try {
        if (captureTabViewRef && captureTabViewRef.webContents && !captureTabViewRef.webContents.isDestroyed() && captureTabViewRef.webContents.mainFrame) {
          const frame = captureTabViewRef.webContents.mainFrame;
          switchMainTab('capture');
          logToFile('Selected source (forced single tab):', { label: 'Вкладка: HDMI Capture', tabKey: 'capture' });
          return safeCallback(withTabAudioIfRequested({ video: frame }, frame));
        }
      } catch (_) {}

      const sources = await desktopCapturer.getSources({
        types: ['window'],
        fetchWindowIcons: false,
        thumbnailSize: { width: 0, height: 0 },
      });
      if (!sources.length) return safeCallback({});

      const captureId = await getExactCaptureSourceId();
      const mainId = getWindowMediaSourceIdSync(mainWinRef);
      const controlId = getWindowMediaSourceIdSync(controlWinRef);
      const overlayId = getWindowMediaSourceIdSync(shareOverlayWinRef);
      const filteredSources = sources.filter(src => {
        if (!src) return false;
        if (src.id === mainId) return false;
        if (src.id === controlId) return false;
        if (overlayId && src.id === overlayId) return false;
        return true;
      });
      const usableSources = filteredSources.length ? filteredSources : sources;

      const byNameIndex = usableSources.findIndex(src => src.name === CAPTURE_WINDOW_TITLE);
      const byIdIndex = captureId ? usableSources.findIndex(src => src.id === captureId) : -1;
      const preferredWindowIndex =
        byIdIndex >= 0
          ? byIdIndex
          : (byNameIndex >= 0 ? byNameIndex : 0);
      const selected = usableSources[Math.max(preferredWindowIndex, 0)];
      if (!selected) return safeCallback({});
      logToFile('Selected source (forced single window):', { id: selected.id, name: selected.name });
      if (selected.name === CAPTURE_WINDOW_TITLE) {
        bringCaptureWindowToFront();
      }
      return safeCallback({ video: selected });
    } catch (err) {
      logToFile('Display media chooser error:', String(err));
      safeCallback({});
    }
    }, { useSystemPicker: false });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
