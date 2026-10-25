// electron/main.cjs - Application entry point, lifecycle manager, and quit guard for Argus

// ── Global error handlers ──────────────────────────────────────────────────
// Catch any synchronous JS exception that escapes every try/catch in the
// main process. Log the full stack trace and keep the app alive if possible
// (only crash when the app is completely unusable).
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
  // Do NOT call app.quit() here — let the exam state machine decide whether
  // a controlled submit/flush is needed before exit.
});

// Catch unresolved Promises (e.g. async IPC handlers that throw without try/catch).
// Log and continue; avoids silent failures.
process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled promise rejection:', reason);
});

const { app, BrowserWindow, session, Menu, dialog } = require('electron');
const { createMainWindow, sendToRenderer, getActiveWindow } = require('./window.cjs');
const { registerIpcHandlers } = require('./ipc/register.cjs');
const { appScope } = require('./core/lifecycle.cjs');
const { examStore, setWindowGetter } = require('./core/examStore.cjs');
const { CHANNELS } = require('./ipc/channels.cjs');
const { installPermissionHandlers } = require('./services/permissions.cjs');
const { isTrustedUrl } = require('./core/trust.cjs');
const { buildMenu } = require('./menu.cjs');
const { initAutosave, flushSync } = require('./core/autosave.cjs');
const storage = require('./services/storage.cjs');
const questionBank = require('./services/questionBank.cjs');
const { notify } = require('./services/notifier.cjs');

// Initialize debounced state autosave
initAutosave(examStore);

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

// Push question bank updates to the renderer
examStore.on('bank-changed', (bankSummary) => {
  sendToRenderer(CHANNELS.QUESTIONS_CHANGED, bankSummary);
});

// Push proctoring violations to the renderer
examStore.on('violation', (violationData) => {
  sendToRenderer(CHANNELS.PROCTOR_VIOLATION, violationData);
});

// State-driven application menu:
// Update the native menu whenever the exam phase changes (e.g. disable clipboard and minimize in 'in_progress')
Menu.setApplicationMenu(buildMenu(examStore.state));
examStore.on('phase', (phase) => {
  Menu.setApplicationMenu(buildMenu(phase));

  // Notify candidate when exam concludes
  if (phase === 'submitted') {
    notify('Exam submitted', `Reason: ${examStore.state.submitReason || 'manual'}`);
  } else if (phase === 'terminated') {
    notify('Exam ended', `Reason: ${examStore.state.submitReason || 'terminated'}`);
  }
});

// Set native macOS About panel metadata
app.setAboutPanelOptions({
  applicationName: 'Argus',
  applicationVersion: app.getVersion(),
  credits: 'Built by Avkash Singh — Application Development, ADYPU',
  copyright: `© ${new Date().getFullYear()} Avkash Singh`,
});

/**
 * Checks for any unfinished exam session (crashed or abruptly closed while in_progress).
 * Invoked once the main application window is ready to show.
 *
 * Rules:
 * 1. If no unfinished session: continue normally.
 * 2. If question bank cannot be found by its SHA-256 hash: mark terminated with reason 'bank_missing'.
 * 3. If time expired while app was closed (now >= endsAt): submit with reason 'time_up_while_closed'.
 *    Comment: The clock keeps running while the app is closed (endsAt is wall-clock), so quitting cannot pause an exam.
 * 4. If time remaining (now < endsAt): show prompt dialog:
 *    - "Resume" -> restore session, re-enter lockdown, restart drift-free timer.
 *    - "Submit it now" -> finish with reason 'submitted_on_resume'.
 *
 * @param {Electron.BrowserWindow} win
 */
async function checkCrashRecovery(win) {
  const session = storage.findUnfinishedSession();
  if (!session) {
    return;
  }

  // Look up question bank by hash
  const bankHash = session.bank?.hash;
  const bankData = bankHash ? questionBank.getBankByHash(bankHash) : null;

  if (!bankData) {
    examStore.terminateSession(session, 'bank_missing');
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Exam Terminated',
      message: 'Question bank missing',
      detail: 'The question bank for your previous exam could not be found on disk. The session has been terminated.',
      buttons: ['OK'],
    });
    return;
  }

  const now = Date.now();
  const endsAt = session.endsAt;

  // Clock kept running while closed: check if time already elapsed
  if (now >= endsAt) {
    examStore.restoreAndSubmit(session, 'time_up_while_closed', bankData);
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Exam Time Expired',
      message: 'Time expired while Argus was closed',
      detail: 'The scheduled time limit for your exam elapsed while the application was closed. Your session has been submitted automatically.',
      buttons: ['OK'],
    });
    return;
  }

  // Time remaining: prompt student
  const startedTimeStr = new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const minutesLeft = Math.max(1, Math.ceil((endsAt - now) / 60000));
  const answeredCount = Object.keys(session.answers || {}).length;

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Resume Exam',
    message: 'Resume your exam?',
    detail: `Started at ${startedTimeStr}. ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} left. ${answeredCount} question${answeredCount === 1 ? '' : 's'} answered.`,
    buttons: ['Resume', 'Submit it now'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    try {
      examStore.restore(session, bankData);
    } catch (err) {
      console.error('[CrashRecovery] Failed to restore session:', err);
      examStore.terminateSession(session, 'corrupt_session');
    }
  } else {
    examStore.restoreAndSubmit(session, 'submitted_on_resume', bankData);
  }
}

// Helper to attach window event listeners including the exam close guard
function setupWindowEvents(win) {
  win.once('ready-to-show', () => {
    checkCrashRecovery(win).catch((err) => {
      console.error('[Main] Error during crash recovery check:', err);
    });
  });

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
    return;
  }
  // Flush any pending debounced autosave state to disk synchronously
  flushSync();
});

// macOS apps normally keep running with no windows, but an exam app should fully exit
app.on('window-all-closed', () => {
  app.quit();
});

// Clean up all resources tracked in the application lifecycle scope
app.on('will-quit', () => {
  flushSync();
  appScope.dispose();
});
