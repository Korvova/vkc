const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controls', {
  goHome: () => ipcRenderer.send('go-home'),
  switchTab: (tab) => ipcRenderer.send('switch-main-tab', tab),
  closeApp: () => ipcRenderer.send('close-app'),
  setForceTabAudio: (enabled) => ipcRenderer.send('set-force-tab-audio', !!enabled),
  getForceTabAudio: () => ipcRenderer.invoke('get-force-tab-audio'),
});
