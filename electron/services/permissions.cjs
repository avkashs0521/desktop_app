// electron/services/permissions.cjs - OS-level and Chromium-level permission manager for Argus
const { systemPreferences, shell } = require('electron');

/**
 * Checks the current macOS camera access authorization status.
 * @returns {'not-determined' | 'granted' | 'denied' | 'restricted'}
 */
function getCameraStatus() {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('camera');
  }
  // Fallback for non-macOS platforms
  return 'granted';
}

/**
 * Requests camera permission from the operating system if not yet determined.
 * Never throws an error if access is denied; returns the updated authorization status.
 * @returns {Promise<{ status: string }>}
 */
async function requestCamera() {
  if (process.platform === 'darwin') {
    const currentStatus = getCameraStatus();
    if (currentStatus === 'not-determined') {
      try {
        await systemPreferences.askForMediaAccess('camera');
      } catch (err) {
        console.warn('[Permissions] askForMediaAccess error:', err);
      }
    }
  }

  return { status: getCameraStatus() };
}

/**
 * Opens macOS Privacy & Security preferences specifically at the Camera section.
 * Hardcoded to this exact Apple preference pane URL to prevent renderer URL injection.
 */
async function openCameraSettings() {
  if (process.platform === 'darwin') {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
  }
}

/**
 * Installs Chromium-level session permission filters.
 *
 * SECURITY ARCHITECTURE NOTE:
 * By default, Electron automatically approves all permission requests from web content.
 * An explicit permissionRequestHandler is required to prevent unmonitored hardware access.
 * We restrict media permissions strictly to 'video' from trusted URLs, denying microphone,
 * geolocation, notifications, and all external devices (USB, HID, Serial).
 *
 * @param {Electron.Session} session - The target Electron session (usually defaultSession).
 * @param {Function} isTrustedUrl - Origin trust validation function.
 */
function installPermissionHandlers(session, isTrustedUrl) {
  // Intercept and evaluate active permission prompts
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isTrusted = details && details.requestingUrl && isTrustedUrl(details.requestingUrl);
    const mediaTypes = details?.mediaTypes || [];
    const isVideoOnly = mediaTypes.includes('video') && !mediaTypes.includes('audio');

    if (permission === 'media' && isVideoOnly && isTrusted) {
      callback(true);
      return;
    }

    console.warn(`[Permissions] Denied permission '${permission}' for URL: ${details?.requestingUrl}`, {
      mediaTypes,
    });
    callback(false);
  });

  // Intercept passive navigator.permissions.query() checks
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'media' && isTrustedUrl(requestingOrigin)) {
      if (details?.mediaType === 'audio') {
        return false;
      }
      return true;
    }
    return false;
  });

  // Block all WebUSB, WebHID, Web Serial, and Web Bluetooth device permissions
  session.setDevicePermissionHandler(() => {
    return false;
  });
}

module.exports = {
  getCameraStatus,
  requestCamera,
  openCameraSettings,
  installPermissionHandlers,
};
