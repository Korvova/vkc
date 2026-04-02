const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controls', {
  goHome: () => ipcRenderer.send('go-home'),
});
