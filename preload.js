const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__PDFSTUDIO_BRIDGE__', {
  info: () => ipcRenderer.invoke('ps-info'),
  saveFile: (name, buf) => ipcRenderer.invoke('ps-save-file', { name, buf }),
  saveMulti: (files) => ipcRenderer.invoke('ps-save-multi', { files }),
  stash: (data) => ipcRenderer.invoke('ps-stash', data),
  restore: () => ipcRenderer.invoke('ps-restore'),
  font: (family) => ipcRenderer.invoke('ps-font', { family }),
  shot: () => ipcRenderer.invoke('ps-shot')
});
