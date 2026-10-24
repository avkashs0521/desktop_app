// electron/ipc/channels.cjs
// Single source of truth for Electron IPC channel names.
// Note: The sandboxed preload script (preload.cjs) cannot require local files from the filesystem,
// so it maintains an exact inline mirror of the channels exposed to the renderer.

const CHANNELS = Object.freeze({
  APP_GET_INFO: 'app:get-info',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_STATE: 'window:state', // main → renderer push: { isMaximized: boolean, isFullScreen: boolean }

  // Exam domain
  EXAM_GET_STATE: 'exam:get-state', // invoke → public state
  EXAM_COMMAND: 'exam:command', // invoke { type, payload } → public state
  EXAM_GET_QUESTIONS: 'exam:get-questions', // invoke → public questions (without answerIndex)
  EXAM_STATE_CHANGED: 'exam:state-changed', // main → renderer push: public state
  EXAM_TICK: 'exam:tick',    // main → renderer push: { remainingMs: number }
  EXAM_WARNING: 'exam:warning', // main → renderer push: { minutesLeft: number }

  // Question bank domain
  QUESTIONS_GET_ACTIVE: 'questions:get-active', // invoke → { title, count, source, fileName, hashShort }
  QUESTIONS_IMPORT: 'questions:import', // invoke → result of importBank
  QUESTIONS_CHANGED: 'questions:changed', // main → renderer push: { title, count, source, fileName, hashShort }

  // Permissions domain
  PERMISSIONS_CAMERA_STATUS: 'permissions:camera-status', // invoke → { status: string }
  PERMISSIONS_REQUEST_CAMERA: 'permissions:request-camera', // invoke → { status: string }
  PERMISSIONS_OPEN_CAMERA_SETTINGS: 'permissions:open-camera-settings', // invoke → void
});

module.exports = { CHANNELS };
