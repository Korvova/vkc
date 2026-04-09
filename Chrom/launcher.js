const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const configPath = path.join(root, 'config.json');
const profileDir = path.join(root, '.profile');
const extensionDir = path.join(root, 'ext-join-link');

function loadConfig() {
  const defaults = {
    scheduleUrl: 'https://crm.brullov.com/app/rms-panel/room/test/1/',
    meetingUrl: 'https://my.mts-link.ru/j/118241477/17695333414',
    telemostUrl: 'https://telemost.yandex.ru/j/66811954592105?source=tab-mail',
    preferredBrowser: 'chrome',
    browserPath: '',
    mode: 'windowed',
    openCaptureTab: true,
    openJoinWidgetTab: true,
    capturePort: 65062,
    autoGrantMedia: true
  };
  if (!fs.existsSync(configPath)) return defaults;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function findBrowser(preferredBrowser, browserPath) {
  if (browserPath && fs.existsSync(browserPath)) {
    return browserPath;
  }

  const chromeCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe'
  ];
  const edgeCandidates = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];

  const ordered = preferredBrowser === 'edge'
    ? [...edgeCandidates, ...chromeCandidates]
    : [...chromeCandidates, ...edgeCandidates];

  return ordered.find((p) => fs.existsSync(p)) || null;
}

function startLocalCaptureServer(port) {
  const captureHtmlPath = path.join(root, 'capture-tab.html');
  const html = fs.readFileSync(captureHtmlPath, 'utf8');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url || req.url === '/' || req.url.startsWith('/capture')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/capture`,
        close: () => {
          try { server.close(); } catch (_) {}
        }
      });
    });
  });
}

async function main() {
  const config = loadConfig();
  const browser = findBrowser(config.preferredBrowser, config.browserPath);
  const forceWindowed = process.argv.includes('--windowed');
  const forceKiosk = process.argv.includes('--kiosk');
  const mode = forceKiosk ? 'kiosk' : (forceWindowed ? 'windowed' : String(config.mode || 'windowed'));
  const kiosk = mode === 'kiosk';

  if (!browser) {
    console.error('Browser not found. Install Chrome/Chromium/Edge or edit Chrom/config.json');
    process.exit(1);
  }

  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    '--new-window',
    '--disable-session-crashed-bubble',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check'
  ];
  if (config.autoGrantMedia) {
    args.push('--use-fake-ui-for-media-stream');
  }

  if (kiosk) {
    args.push('--kiosk');
  }

  const urls = [];
  urls.push(config.scheduleUrl);

  if (config.openJoinWidgetTab) {
    const encodedMeetingUrl = encodeURIComponent(String(config.meetingUrl || ''));
    urls.push(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html>
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
            width: min(680px, 92vw);
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
            <a id="joinMtsBtn" class="btn" href="${String(config.meetingUrl || '').replace(/"/g, '&quot;')}" target="_self" rel="noopener noreferrer">Открыть МТС Линк</a>
            <a id="joinTelemostBtn" class="btn" href="${String(config.telemostUrl || '').replace(/"/g, '&quot;')}" target="_self" rel="noopener noreferrer">Открыть Телемост</a>
            <button id="copyBtn" class="btn secondary">Скопировать ссылку</button>
          </div>
          <div class="url">MTS: <span id="meetingUrl">${String(config.meetingUrl || '')}</span></div>
          <div class="url">Telemost: <span id="telemostUrl">${String(config.telemostUrl || '')}</span></div>
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
      </html>
    `)}`);
  }

  let captureServer = null;
  if (config.openCaptureTab) {
    captureServer = await startLocalCaptureServer(Number(config.capturePort) || 65062);
    urls.push(captureServer.url);
  }
  args.push(...urls);

  console.log(`Launching: ${browser}`);
  console.log(`Mode: ${kiosk ? 'kiosk' : 'windowed'}`);
  console.log(`Schedule URL: ${config.scheduleUrl}`);
  if (config.openJoinWidgetTab) {
    console.log(`Join widget meeting URL: ${config.meetingUrl}`);
    console.log(`Join widget telemost URL: ${config.telemostUrl}`);
  }
  if (captureServer) {
    console.log(`Capture tab: ${captureServer.url}`);
  }

  const child = spawn(browser, args, {
    cwd: root,
    detached: false,
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    if (captureServer) captureServer.close();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
