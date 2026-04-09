const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mirrorAPI', {
  onFrame: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, dataUrl) => handler(dataUrl);
    ipcRenderer.on('mirror-frame', listener);
    return () => ipcRenderer.removeListener('mirror-frame', listener);
  },
});

