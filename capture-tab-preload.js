const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureTabControls', {
  stopShareAndCloseTab: () => ipcRenderer.send('capture-tab-stop-share'),
});

