// electron/main.cjs - Application entry point and lifecycle manager for Argus
const { app, BrowserWindow } = require('electron');
const { createMainWindow } = require('./window.cjs');

// Module-level reference to prevent garbage collection from closing the window prematurely
let mainWindow = null;

// Initialize the main application window once Electron has finished initialization
app.whenReady().then(() => {
  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

// On macOS, recreate a window when the dock icon is clicked and no windows exist
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }
});

// macOS apps normally keep running with no windows, but an exam app should fully exit
app.on('window-all-closed', () => {
  app.quit();
});
