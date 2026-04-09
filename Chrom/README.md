# Chromium Kiosk Prototype

This folder runs your workflow in a real Chromium-based browser (Chrome/Edge):
- tab 1: schedule page
- tab 2: HDMI capture tab (to select during screen sharing)

## Run

```powershell
cd C:\Users\Владимир\Documents\App\vkc\Chrom
npm start
```

Windowed mode:

```powershell
npm run start:windowed
```

Kiosk mode:

```powershell
npm run start:kiosk
```

## Config

Edit `config.json`:

- `scheduleUrl`: schedule page URL (first tab)
- `preferredBrowser`: `chrome` or `edge`
- `browserPath`: optional absolute path to specific browser binary (overrides `preferredBrowser`)
- `mode`: `windowed` or `kiosk`
- `openCaptureTab`: open second HDMI tab (`true/false`)
- `capturePort`: fixed local port for capture tab (use fixed value to keep browser permission stable)
- `autoGrantMedia`: when `true`, launcher adds `--use-fake-ui-for-media-stream` (no camera prompt)

## Notes

- This is not Electron rendering. It launches the system browser shell, so screen-share UX is closer to normal browser behavior.
- The capture tab is served from local `http://127.0.0.1:<port>/capture`.
- Browser profile is stored in `Chrom/.profile`.
