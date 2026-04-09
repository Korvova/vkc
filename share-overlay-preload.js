const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayControls', {
  back: () => ipcRenderer.send('overlay-back'),
  stopShare: () => ipcRenderer.send('overlay-stop-share'),
  setCaptureOpacity: (value) => ipcRenderer.send('overlay-set-capture-opacity', value),
  getCaptureOpacity: () => ipcRenderer.invoke('overlay-get-capture-opacity'),
});
