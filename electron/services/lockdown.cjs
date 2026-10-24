// electron/services/lockdown.cjs - Exam lockdown: rules dialog, kiosk mode, and power management

const { dialog, powerSaveBlocker } = require('electron');
const { config } = require('../core/config.cjs');

/**
 * Shows the exam rules in a native dialog sheet attached to the window.
 * Accepted only when the candidate clicks "I agree" AND ticks the checkbox.
 *
 * @param {Electron.BrowserWindow} win - The window to attach the sheet to.
 * @returns {Promise<boolean>} true if the rules were accepted with the checkbox ticked.
 */
async function showRulesDialog(win) {
  // Build numbered rules from exam.config.json
  const rulesDetail = [
    `1. Duration: ${config.durationMinutes} minutes.`,
    '2. Keep the camera on at all times.',
    '3. Stay in this window throughout the exam.',
    '4. Close all chat, meeting and remote-desktop apps.',
    '5. Use one monitor only.',
    `6. After ${config.maxViolations} violations the exam ends automatically.`,
  ].join('\n');

  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Exam rules',
    message: 'Read these rules before you start',
    detail: rulesDetail,
    buttons: ['I agree — start exam', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    // The checkbox acts as a deliberate acknowledgement step to prevent accidental acceptance
    checkboxLabel: 'I have read and understood the rules',
    checkboxChecked: false,
  });

  // Candidate clicked "I agree" but did not tick the acknowledgement checkbox
  if (response === 0 && !checkboxChecked) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Acknowledgement Required',
      message: 'Please tick the checkbox to confirm you have read the rules.',
      buttons: ['OK'],
    });
    return false;
  }

  // Return true only if both conditions are satisfied: agreed AND checkbox ticked
  return response === 0 && checkboxChecked;
}

let currentBlockerId = null;

/**
 * Activates exam lockdown: kiosk mode, always-on-top, content protection, and power-save blocker.
 * All undo actions are registered with the provided lifecycle scope so they are
 * reversed automatically when the exam scope is disposed (exam ends).
 *
 * @param {Electron.BrowserWindow} win
 * @param {Object} scope - A createScope() lifecycle scope that owns these resources.
 */
function enter(win, scope) {
  // setKiosk(true): On macOS, kiosk mode hides the Dock and menu bar and blocks app switching on macOS.
  win.setKiosk(true);

  // setAlwaysOnTop(true, 'screen-saver'): Keeps the window above all other windows including full-screen apps.
  win.setAlwaysOnTop(true, 'screen-saver');

  // setContentProtection(true): Content protection makes screenshots and screen recordings show a black window.
  win.setContentProtection(true);

  // powerSaveBlocker.start('prevent-display-sleep'): The power-save blocker stops the display sleeping mid-exam.
  currentBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  // Register the matching undo with the lifecycle scope
  if (scope && typeof scope.track === 'function') {
    scope.track(() => exit(win));
  }
}

/**
 * Reverses all four lockdown settings. Safe to call twice.
 *
 * @param {Electron.BrowserWindow} win
 */
function exit(win) {
  if (win && !win.isDestroyed()) {
    win.setKiosk(false);
    win.setAlwaysOnTop(false);
    win.setContentProtection(false);
  }

  // Stop the power-save blocker only if isStarted
  if (currentBlockerId !== null && powerSaveBlocker.isStarted(currentBlockerId)) {
    powerSaveBlocker.stop(currentBlockerId);
    currentBlockerId = null;
  }
}

/**
 * Shows the submit confirmation dialog from the main process.
 * Called when SUBMIT_EXAM comes from the renderer (source = 'renderer').
 *
 * @param {Electron.BrowserWindow} win
 * @param {Object} [stats]
 * @param {number} [stats.answeredCount]
 * @param {number} [stats.totalCount]
 * @param {number} [stats.reviewCount]
 * @returns {Promise<boolean>} true if confirmed.
 */
async function showSubmitConfirm(win, stats = {}) {
  const answeredCount = typeof stats.answeredCount === 'number' ? stats.answeredCount : 0;
  const totalCount = typeof stats.totalCount === 'number' ? stats.totalCount : 0;
  const reviewCount = typeof stats.reviewCount === 'number' ? stats.reviewCount : 0;

  const detail = `You answered ${answeredCount} of ${totalCount} questions. ${reviewCount} are marked for review.`;

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Submit Exam',
    message: 'Submit your exam?',
    detail,
    buttons: ['Cancel', 'Submit'],
    defaultId: 1,
    cancelId: 0,
  });
  return response === 1; // 1 = "Submit"
}

/**
 * Shows the exam rules in an info-only dialog with a single OK button (used by Help > Exam Rules).
 *
 * @param {Electron.BrowserWindow} win
 */
async function showRulesInfo(win) {
  const rulesDetail = [
    `1. Duration: ${config.durationMinutes} minutes.`,
    '2. Keep the camera on at all times.',
    '3. Stay in this window throughout the exam.',
    '4. Close all chat, meeting and remote-desktop apps.',
    '5. Use one monitor only.',
    `6. After ${config.maxViolations} violations the exam ends automatically.`,
  ].join('\n');

  await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Exam rules',
    message: 'Argus Exam Rules',
    detail: rulesDetail,
    buttons: ['OK'],
    defaultId: 0,
  });
}

module.exports = {
  showRulesDialog,
  showRulesInfo,
  showSubmitConfirm,
  enter,
  exit,
};
