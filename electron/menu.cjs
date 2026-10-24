// electron/menu.cjs - State-driven application menu for Argus
const { Menu, app } = require('electron');
const { showRulesInfo } = require('./services/lockdown.cjs');
const { getActiveWindow } = require('./window.cjs');

/**
 * Builds the application menu based on current exam state / phase.
 * In macOS, an Edit menu with standard roles is required for keyboard shortcuts
 * like Cmd+C, Cmd+V, and Cmd+X to work in input fields.
 *
 * During active exams (phase === 'in_progress'):
 * - Cut, copy, and paste are disabled to prevent copying answers or pasting external text.
 * - Window minimize is disabled to enforce lockdown.
 *
 * @param {Object|string} state - The exam state object or current phase string.
 * @returns {Electron.Menu} The configured application menu.
 */
function buildMenu(state) {
  const phase = typeof state === 'string' ? state : state?.phase;
  const inExam = phase === 'in_progress';
  const isDev = !app.isPackaged;

  const template = [
    // macOS Application menu
    {
      label: 'Argus',
      submenu: [
        { label: 'About Argus', role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { type: 'separator' },
        {
          label: 'Quit Argus',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            // Invokes app.quit(), which is intercepted by the quit guard during exams
            app.quit();
          },
        },
      ],
    },

    // Edit Menu:
    // Without an Edit menu, Cmd+C / Cmd+V do not work in text inputs on macOS.
    // During an exam, clipboard operations (cut/copy/paste) are disabled.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut', enabled: !inExam },
        { role: 'copy', enabled: !inExam },
        { role: 'paste', enabled: !inExam },
        { role: 'selectAll' },
      ],
    },

    // View Menu: development only (reload and devTools inspection)
    ...(isDev
      ? [
          {
            label: 'View',
            submenu: [
              { role: 'reload' },
              { role: 'toggleDevTools' },
            ],
          },
        ]
      : []),

    // Window Menu: minimize disabled while in_progress
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', enabled: !inExam },
      ],
    },

    // Help Menu: Exam rules info dialog
    {
      label: 'Help',
      submenu: [
        {
          label: 'Exam Rules',
          click: (_, focusedWindow) => {
            const win = focusedWindow || getActiveWindow();
            if (win) {
              showRulesInfo(win);
            }
          },
        },
      ],
    },

    // Room for later menu items:
    // - File menu will be added in Commit 6 (audit log export) and Commit 9
    // - Theme menu will be added in Commit 9
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = {
  buildMenu,
};
