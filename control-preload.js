const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controls', {
  goHome: () => ipcRenderer.send('go-home'),
  switchTab: (tab) => ipcRenderer.send('switch-main-tab', tab),
  closeApp: () => ipcRenderer.send('close-app'),
});
