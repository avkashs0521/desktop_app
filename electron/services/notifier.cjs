// electron/services/notifier.cjs - Native desktop notifications
const { Notification } = require('electron');

/**
 * Displays a system notification if supported by the OS.
 * @param {string} title
 * @param {string} body
 */
function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

module.exports = {
  notify,
};
