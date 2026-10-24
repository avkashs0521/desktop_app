// electron/window.cjs - BrowserWindow creation, security guards, and push messaging for Argus
const { BrowserWindow, app } = require('electron');
const path = require('path');
const { CHANNELS } = require('./ipc/channels.cjs');
const { isTrustedUrl } = require('./core/trust.cjs');

// Module-level reference to the active window for push messaging
let activeWindow = null;

/**
 * Sends an IPC message from the main process to the renderer process.
 * Safely acts as a no-op if the window does not exist or has been destroyed.
 * @param {string} channel - The IPC channel name.
 * @param {any} payload - The serializable data payload.
 */
function sendToRenderer(channel, payload) {
  if (activeWindow && !activeWindow.isDestroyed()) {
    activeWindow.webContents.send(channel, payload);
  }
}

/**
 * Creates and configures the primary frameless application window with security guards.
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
    frame: false, // Frameless window to allow our custom security TitleBar
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

  activeWindow = mainWindow;
  mainWindow.on('closed', () => {
    if (activeWindow === mainWindow) {
      activeWindow = null;
    }
  });

  // Push updated window maximize/fullscreen state to renderer
  const pushWindowState = () => {
    sendToRenderer(CHANNELS.WINDOW_STATE, {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    });
  };

  mainWindow.on('maximize', pushWindowState);
  mainWindow.on('unmaximize', pushWindowState);
  mainWindow.on('enter-full-screen', pushWindowState);
  mainWindow.on('leave-full-screen', pushWindowState);

  // Security navigation guard: prevent navigating away from application content
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  // Security popup guard: block all new window/tab requests (e.g., window.open or target="_blank")
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Security webview guard: prevent injection or mounting of <webview> tags
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Gracefully reveal window only when DOM content has rendered to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    pushWindowState();
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

function getActiveWindow() {
  return activeWindow;
}

module.exports = {
  createMainWindow,
  sendToRenderer,
  getActiveWindow,
};
