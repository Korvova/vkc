const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getCaptureSourceId: () => ipcRenderer.invoke('get-capture-source-id'),
  setShareActive: (active) => ipcRenderer.send('share-active', !!active),
  setSharePickerActive: (active) => ipcRenderer.send('share-picker-active', !!active),
});
