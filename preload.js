'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  openFolder:     ()            => ipcRenderer.invoke('dialog:openFolder'),
  getVersion:     ()            => ipcRenderer.invoke('app:version'),
  restart:        ()            => ipcRenderer.invoke('app:restart'),
  saveEnv:        (data)        => ipcRenderer.invoke('env:save', data),
  loadEnv:        ()            => ipcRenderer.invoke('env:load'),

  plugin: {
    list:    ()          => ipcRenderer.invoke('plugin:list'),
    install: (url)       => ipcRenderer.invoke('plugin:install', url),
    toggle:  (id)        => ipcRenderer.invoke('plugin:toggle', id),
    remove:  (id)        => ipcRenderer.invoke('plugin:remove', id),
  },

  on:  (ch, fn) => { ipcRenderer.on(ch, (_e, ...a) => fn(...a)); },
  off: (ch, fn) => { ipcRenderer.removeListener(ch, fn); },
});
