// electron/main.cjs - Application entry point and lifecycle manager for Argus
const { app, BrowserWindow } = require('electron');
const { createMainWindow, sendToRenderer } = require('./window.cjs');
const { registerIpcHandlers } = require('./ipc/register.cjs');
const { appScope } = require('./core/lifecycle.cjs');
const { examStore } = require('./core/examStore.cjs');
const { CHANNELS } = require('./ipc/channels.cjs');

// Module-level reference to prevent garbage collection from closing the window prematurely
let mainWindow = null;

// Register all IPC contract handlers once before the window is created
registerIpcHandlers({
  getMainWindow: () => mainWindow,
});

// Push state changes to the renderer whenever the exam store updates
examStore.on('change', (state) => {
  sendToRenderer(CHANNELS.EXAM_STATE_CHANGED, state);
});

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

// Clean up all resources tracked in the application lifecycle scope
app.on('will-quit', () => {
  appScope.dispose();
});
