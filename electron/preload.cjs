// electron/preload.cjs
// Secure preload bridge exposing strictly controlled APIs from the main process to the renderer.

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Sandboxed preload scripts cannot require external or relative files from disk.
 * We maintain an explicit inline mirror of only the approved IPC channels this renderer may interact with.
 */
const CHANNELS = Object.freeze({
  APP_GET_INFO: 'app:get-info',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_STATE: 'window:state',

  // Exam domain
  EXAM_GET_STATE: 'exam:get-state',
  EXAM_COMMAND: 'exam:command',
  EXAM_GET_QUESTIONS: 'exam:get-questions',
  EXAM_STATE_CHANGED: 'exam:state-changed',
  EXAM_TICK: 'exam:tick',
  EXAM_WARNING: 'exam:warning',

  // Question bank domain
  QUESTIONS_GET_ACTIVE: 'questions:get-active',
  QUESTIONS_IMPORT: 'questions:import',
  QUESTIONS_CHANGED: 'questions:changed',

  // Permissions domain
  PERMISSIONS_CAMERA_STATUS: 'permissions:camera-status',
  PERMISSIONS_REQUEST_CAMERA: 'permissions:request-camera',
  PERMISSIONS_OPEN_CAMERA_SETTINGS: 'permissions:open-camera-settings',

  // Settings & History domain
  SETTINGS_GET: 'settings:get',
  HISTORY_LIST: 'history:list',

  // Proctoring domain
  PROCTOR_SAVE_SNAPSHOT: 'proctor:save-snapshot',
  PROCTOR_VIOLATION: 'proctor:violation',
});

/**
 * Helper to invoke an IPC channel with a payload.
 * @param {string} channel
 * @param {any} [payload]
 * @returns {Promise<any>}
 */
function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

/**
 * Helper to subscribe to main process push events on an approved channel.
 * Wraps the callback so only the payload is passed, preventing leakage of the internal IPC event object.
 * Returns a dedicated unsubscription function.
 * @param {string} channel
 * @param {Function} callback - Function receiving (payload)
 * @returns {Function} Unsubscribe function
 */
function subscribe(channel, callback) {
  const listener = (_event, payload) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

/**
 * SECURITY ARCHITECTURE NOTE:
 * Never expose raw `ipcRenderer` or a generic `send(channel, ...)` / `invoke(channel, ...)` method.
 * Exposing generic IPC primitives allows any script in the renderer (or an attacker exploiting an XSS flaw)
 * to communicate with arbitrary internal channels or intercept sensitive messages.
 * Only narrow, explicitly defined functions mapped to predefined channels are exposed.
 */
contextBridge.exposeInMainWorld('argus', {
  app: {
    getInfo: () => invoke(CHANNELS.APP_GET_INFO),
  },
  window: {
    minimize: () => invoke(CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => invoke(CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    close: () => invoke(CHANNELS.WINDOW_CLOSE),
    onState: (callback) => subscribe(CHANNELS.WINDOW_STATE, callback),
  },
  exam: {
    getState: () => invoke(CHANNELS.EXAM_GET_STATE),
    getQuestions: () => invoke(CHANNELS.EXAM_GET_QUESTIONS),
    send: (type, payload) => invoke(CHANNELS.EXAM_COMMAND, { type, payload }),
    onState: (callback) => subscribe(CHANNELS.EXAM_STATE_CHANGED, callback),
    onTick: (callback) => subscribe(CHANNELS.EXAM_TICK, callback),
    onWarning: (callback) => subscribe(CHANNELS.EXAM_WARNING, callback),
  },
  questions: {
    getActive: () => invoke(CHANNELS.QUESTIONS_GET_ACTIVE),
    import: () => invoke(CHANNELS.QUESTIONS_IMPORT),
    onChanged: (callback) => subscribe(CHANNELS.QUESTIONS_CHANGED, callback),
  },
  permissions: {
    cameraStatus: () => invoke(CHANNELS.PERMISSIONS_CAMERA_STATUS),
    requestCamera: () => invoke(CHANNELS.PERMISSIONS_REQUEST_CAMERA),
    openCameraSettings: () => invoke(CHANNELS.PERMISSIONS_OPEN_CAMERA_SETTINGS),
  },
  settings: {
    get: () => invoke(CHANNELS.SETTINGS_GET),
  },
  history: {
    list: () => invoke(CHANNELS.HISTORY_LIST),
  },
  proctor: {
    saveSnapshot: (bytes) => invoke(CHANNELS.PROCTOR_SAVE_SNAPSHOT, bytes),
    onViolation: (callback) => subscribe(CHANNELS.PROCTOR_VIOLATION, callback),
  },
});
