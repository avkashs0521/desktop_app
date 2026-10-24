// electron/ipc/register.cjs
// Central registration module for all IPC handlers with sender validation and error envelopes.

const { ipcMain, app } = require('electron');
const { CHANNELS } = require('./channels.cjs');

/**
 * Validates that an incoming IPC event originates from our legitimate, trusted application window.
 * Ensures the sender is the main window's webContents and that the frame URL matches our dev URL or local file scheme.
 * @param {Electron.IpcMainInvokeEvent} event - The IPC event.
 * @param {Function} getMainWindow - Getter returning the active BrowserWindow.
 * @returns {boolean} True if the sender is verified as trusted.
 */
function isTrustedSender(event, getMainWindow) {
  if (!event || !event.senderFrame) {
    return false;
  }

  const mainWindow = getMainWindow ? getMainWindow() : null;
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return false;
  }

  const frameUrl = event.senderFrame.url;
  if (!frameUrl) {
    return false;
  }

  if (process.env.ARGUS_DEV_URL) {
    return frameUrl.startsWith(process.env.ARGUS_DEV_URL);
  }

  return frameUrl.startsWith('file://');
}

/**
 * Registers all IPC handlers for the application.
 * Handlers are grouped by functional domain.
 * @param {Object} options
 * @param {Function} options.getMainWindow - Function returning the main BrowserWindow instance.
 */
function registerIpcHandlers({ getMainWindow }) {
  /**
   * Helper to register a protected IPC handler wrapped in standard response envelopes.
   * @param {string} channel
   * @param {Function} fn - Handler function receiving (payload, event)
   */
  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!isTrustedSender(event, getMainWindow)) {
        return {
          ok: false,
          error: {
            code: 'FORBIDDEN',
            message: `Untrusted IPC sender for channel: ${channel}`,
          },
        };
      }

      try {
        const data = await fn(payload, event);
        return { ok: true, data };
      } catch (err) {
        console.error(`[IPC Error: ${channel}]`, err);
        return {
          ok: false,
          error: {
            code: err.code || 'INTERNAL',
            message: err.message || 'An internal error occurred',
          },
        };
      }
    });
  }

  // ==========================================
  // App Domain Handlers
  // ==========================================
  handle(CHANNELS.APP_GET_INFO, async () => {
    return {
      name: app.name,
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
      electronVersion: process.versions.electron,
    };
  });

  // ==========================================
  // Window Control Handlers
  // ==========================================
  handle(CHANNELS.WINDOW_MINIMIZE, async () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
    return null;
  });

  handle(CHANNELS.WINDOW_TOGGLE_MAXIMIZE, async () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    return null;
  });

  handle(CHANNELS.WINDOW_CLOSE, async () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.close();
    }
    return null;
  });

  // ==========================================
  // Exam Domain Handlers
  // ==========================================
  handle(CHANNELS.EXAM_GET_STATE, async () => {
    const { examStore } = require('../core/examStore.cjs');
    return examStore.getPublicState();
  });

  handle(CHANNELS.EXAM_COMMAND, async (payload) => {
    const { examStore } = require('../core/examStore.cjs');
    const { type, payload: commandPayload } = payload || {};
    if (!type || typeof type !== 'string') {
      const err = new Error('exam:command requires a valid command type string.');
      err.code = 'VALIDATION';
      throw err;
    }
    return await examStore.dispatch(type, { source: 'renderer', payload: commandPayload });
  });
}

module.exports = {
  isTrustedSender,
  registerIpcHandlers,
};
