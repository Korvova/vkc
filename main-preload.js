const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getCaptureSourceId: () => ipcRenderer.invoke('get-capture-source-id'),
});
