// electron/ipc/register.cjs
// Central registration module for all IPC handlers with sender validation and error envelopes.

const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { CHANNELS } = require('./channels.cjs');
const { isTrustedUrl } = require('../core/trust.cjs');
const permissionsService = require('../services/permissions.cjs');

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
  return isTrustedUrl(frameUrl);
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
    const { examStore } = require('../core/examStore.cjs');
    // Minimize is refused while an exam is in progress
    if (examStore.state.phase === 'in_progress') {
      return null;
    }
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
    const { examStore } = require('../core/examStore.cjs');
    // Direct close request refused during active exam (must go through quit guard or submission)
    if (examStore.state.phase === 'in_progress') {
      return null;
    }
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

  handle(CHANNELS.EXAM_GET_QUESTIONS, async () => {
    const { examStore } = require('../core/examStore.cjs');
    const { toPublicQuestions, getActiveBank } = require('../services/questionBank.cjs');

    // Security guard: questions are only disclosed while the exam is active
    if (examStore.state.phase !== 'in_progress') {
      const err = new Error('Questions are accessible only during an active exam session.');
      err.code = 'INVALID_PHASE';
      throw err;
    }

    const { bank } = getActiveBank();
    return toPublicQuestions(bank, examStore.state.questionOrder);
  });

  // ==========================================
  // Question Bank Domain Handlers
  // ==========================================
  handle(CHANNELS.QUESTIONS_GET_ACTIVE, async () => {
    const { getActiveBankSummary } = require('../services/questionBank.cjs');
    return getActiveBankSummary();
  });

  handle(CHANNELS.QUESTIONS_IMPORT, async () => {
    const { importBank } = require('../services/questionBank.cjs');
    const win = getMainWindow();
    return await importBank(win);
  });

  // ==========================================
  // Permissions Domain Handlers
  // ==========================================
  handle(CHANNELS.PERMISSIONS_CAMERA_STATUS, async () => {
    return { status: permissionsService.getCameraStatus() };
  });

  handle(CHANNELS.PERMISSIONS_REQUEST_CAMERA, async () => {
    return await permissionsService.requestCamera();
  });

  handle(CHANNELS.PERMISSIONS_OPEN_CAMERA_SETTINGS, async () => {
    await permissionsService.openCameraSettings();
    return null;
  });

  // ==========================================
  // Settings & History Domain Handlers
  // ==========================================
  handle(CHANNELS.SETTINGS_GET, async () => {
    const storage = require('../services/storage.cjs');
    const { getActiveBankSummary } = require('../services/questionBank.cjs');
    const settings = storage.getSettings();
    return {
      theme: settings.theme,
      candidate: settings.candidate,
      activeBank: getActiveBankSummary(),
    };
  });

  handle(CHANNELS.HISTORY_LIST, async () => {
    const storage = require('../services/storage.cjs');
    const sessions = storage.listSessions();
    return sessions.slice(0, 10);
  });

  // ==========================================
  // Proctoring Domain Handlers
  // ==========================================
  handle(CHANNELS.PROCTOR_SAVE_SNAPSHOT, async (bytes) => {
    const { examStore } = require('../core/examStore.cjs');
    if (examStore.state.phase !== 'in_progress') {
      const err = new Error('Snapshots are accepted only while exam is in progress.');
      err.code = 'INVALID_PHASE';
      throw err;
    }

    if (!bytes) {
      const err = new Error('No snapshot data provided.');
      err.code = 'INVALID_PAYLOAD';
      throw err;
    }

    const buf = Buffer.from(new Uint8Array(bytes));
    if (buf.length < 1024) {
      const err = new Error('Snapshot size must be at least 1 KB.');
      err.code = 'FILE_TOO_SMALL';
      throw err;
    }
    if (buf.length > 2 * 1024 * 1024) {
      const err = new Error('Snapshot size must not exceed 2 MB.');
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }

    // JPEG magic bytes: FF D8 FF
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      const err = new Error('Invalid image format: must be JPEG (magic bytes FF D8 FF).');
      err.code = 'INVALID_FORMAT';
      throw err;
    }

    const sessionId = examStore.state.sessionId;
    const proctorSessionDir = path.join(app.getPath('userData'), 'proctor', sessionId);
    await fs.promises.mkdir(proctorSessionDir, { recursive: true });

    const currentCount = examStore.state.snapshotCount || 0;
    const newCount = currentCount + 1;
    const countStr = String(newCount).padStart(4, '0');
    const fileName = `snap-${countStr}-${Date.now()}.jpg`;
    const filePath = path.join(proctorSessionDir, fileName);

    await fs.promises.writeFile(filePath, buf);
    await examStore.dispatch('SNAPSHOT_SAVED', { source: 'main' });

    return { count: newCount };
  });
}

module.exports = {
  isTrustedSender,
  registerIpcHandlers,
};
