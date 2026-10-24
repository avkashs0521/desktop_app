// electron/window.cjs - BrowserWindow creation and configuration for Argus
const { BrowserWindow, app } = require('electron');
const path = require('path');

/**
 * Creates and configures the primary application window.
 * Configured with strict security settings for a proctored exam environment.
 * @returns {BrowserWindow} The created window instance.
 */
function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'Argus',
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // contextIsolation: separates preload scripts from the webpage execution context to avoid prototype pollution
      contextIsolation: true,
      // nodeIntegration: prevents the renderer window from accessing Node.js runtime APIs directly
      nodeIntegration: false,
      // sandbox: enforces Chromium OS-level sandboxing on the renderer process for defense-in-depth
      sandbox: true,
      // webSecurity: enforces same-origin policy and blocks insecure cross-origin requests
      webSecurity: true,
      // devTools: enables inspection tools during development while preventing student access in production
      devTools: !app.isPackaged,
    },
  });

  // Gracefully reveal window only when DOM content has rendered to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // In development, load from Vite dev server and open detached DevTools.
  // In production, load the built static HTML file directly.
  if (process.env.ARGUS_DEV_URL) {
    mainWindow.loadURL(process.env.ARGUS_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  return mainWindow;
}

module.exports = { createMainWindow };
