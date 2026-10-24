// electron/main.cjs - Application entry point, lifecycle manager, and quit guard for Argus
const { app, BrowserWindow, session, Menu, dialog } = require('electron');
const { createMainWindow, sendToRenderer, getActiveWindow } = require('./window.cjs');
const { registerIpcHandlers } = require('./ipc/register.cjs');
const { appScope } = require('./core/lifecycle.cjs');
const { examStore, setWindowGetter } = require('./core/examStore.cjs');
const { CHANNELS } = require('./ipc/channels.cjs');
const { installPermissionHandlers } = require('./services/permissions.cjs');
const { isTrustedUrl } = require('./core/trust.cjs');
const { buildMenu } = require('./menu.cjs');

// 5. Single instance lock:
// Ensure only one instance of Argus runs at any time.
// If another instance tries to launch, focus the existing instance and exit the new one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

// Module-level reference to prevent garbage collection from closing the window prematurely
let mainWindow = null;

// Quit guard flags:
// allowQuit: set to true only when quit is legitimately permitted (e.g. after candidate confirms submit-and-quit)
// quitDialogOpen: prevents stacking multiple confirmation dialogs if Cmd+Q is pressed repeatedly
let allowQuit = false;
let quitDialogOpen = false;

/**
 * Quit guard dialog shown when the user attempts to exit during an active exam.
 * If candidate chooses "Submit and quit":
 * 1. Dispatches SUBMIT_EXAM with source 'main' and reason 'quit'.
 * 2. Sets allowQuit = true to bypass further lifecycle prevention.
 * 3. Re-issues app.quit() to cleanly exit.
 */
async function confirmQuitDuringExam() {
  if (quitDialogOpen) return;
  if (examStore.state.phase !== 'in_progress') return;

  quitDialogOpen = true;
  try {
    const win = mainWindow || getActiveWindow() || BrowserWindow.getFocusedWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Quit Argus',
      message: 'Quit and submit your exam?',
      detail: 'Your exam answers will be submitted and the exam will end immediately.',
      buttons: ['Keep working', 'Submit and quit'],
      defaultId: 0,
      cancelId: 0,
    });

    if (response === 1) {
      await examStore.dispatch('SUBMIT_EXAM', {
        source: 'main',
        payload: { reason: 'quit' },
      });
      allowQuit = true;
      app.quit();
    }
  } finally {
    quitDialogOpen = false;
  }
}

// Register all IPC contract handlers once before the window is created
registerIpcHandlers({
  getMainWindow: () => mainWindow,
});

// Configure examStore with window getter so modal dialogs (rules & submit confirmation) can bind as sheets
setWindowGetter(() => mainWindow);

// Push state changes to the renderer whenever the exam store updates
examStore.on('change', (state) => {
  sendToRenderer(CHANNELS.EXAM_STATE_CHANGED, state);
});

// State-driven application menu:
// Update the native menu whenever the exam phase changes (e.g. disable clipboard and minimize in 'in_progress')
Menu.setApplicationMenu(buildMenu(examStore.state));
examStore.on('phase', (phase) => {
  Menu.setApplicationMenu(buildMenu(phase));
});

// Set native macOS About panel metadata
app.setAboutPanelOptions({
  applicationName: 'Argus',
  applicationVersion: app.getVersion(),
  credits: 'Built by Avkash Singh — Application Development, ADYPU',
  copyright: `© ${new Date().getFullYear()} Avkash Singh`,
});

// Helper to attach window event listeners including the exam close guard
function setupWindowEvents(win) {
  win.on('close', (event) => {
    // Intercept window close during exam to prompt for submission
    if (!allowQuit && examStore.state.phase === 'in_progress') {
      event.preventDefault();
      confirmQuitDuringExam();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize the main application window once Electron has finished initialization
app.whenReady().then(() => {
  // Install strict Chromium-level media and device permission handlers
  installPermissionHandlers(session.defaultSession, isTrustedUrl);

  mainWindow = createMainWindow();
  setupWindowEvents(mainWindow);
});

// On macOS, recreate a window when the dock icon is clicked and no windows exist
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    setupWindowEvents(mainWindow);
  }
});

// Electron quit lifecycle (in order of occurrence):
// 1. before-quit   -> Emitted on the app object before any window begins closing.
//                     Can be cancelled with event.preventDefault() to prompt the candidate.
// 2. close         -> Emitted on each individual BrowserWindow before it closes.
//                     Can also be cancelled with event.preventDefault().
// 3. will-quit     -> Emitted after all windows have closed and app is committing to quit.
// 4. quit          -> Emitted when the application has definitively quit.

app.on('before-quit', (event) => {
  if (!allowQuit && examStore.state.phase === 'in_progress') {
    event.preventDefault();
    confirmQuitDuringExam();
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
