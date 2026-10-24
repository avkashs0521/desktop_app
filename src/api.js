// src/api.js - Renderer-side API client wrapping the window.argus preload bridge

export const isElectron = typeof window !== 'undefined' && Boolean(window.argus);

/**
 * Unwraps standard IPC response envelopes { ok: true, data } or throws on { ok: false, error }.
 * @template T
 * @param {Promise<{ ok: boolean, data?: T, error?: { code: string, message: string } }>} promise
 * @returns {Promise<T>}
 */
async function unwrap(promise) {
  const res = await promise;
  if (!res || !res.ok) {
    const error = new Error(res?.error?.message || 'IPC request failed');
    error.code = res?.error?.code || 'INTERNAL';
    throw error;
  }
  return res.data;
}

function ensureDesktop() {
  const error = new Error('Argus must run inside the desktop app');
  error.code = 'NOT_ELECTRON';
  throw error;
}

/**
 * Strongly-typed API interface for the renderer.
 * Components must import and interact through `api` rather than referencing `window.argus` directly.
 */
export const api = {
  app: {
    getInfo: () => (isElectron ? unwrap(window.argus.app.getInfo()) : ensureDesktop()),
  },
  window: {
    minimize: () => (isElectron ? unwrap(window.argus.window.minimize()) : ensureDesktop()),
    toggleMaximize: () => (isElectron ? unwrap(window.argus.window.toggleMaximize()) : ensureDesktop()),
    close: () => (isElectron ? unwrap(window.argus.window.close()) : ensureDesktop()),
    onState: (callback) => {
      if (!isElectron) {
        return () => {};
      }
      return window.argus.window.onState(callback);
    },
  },
  exam: {
    getState: () => (isElectron ? unwrap(window.argus.exam.getState()) : ensureDesktop()),
    send: (type, payload) => (isElectron ? unwrap(window.argus.exam.send(type, payload)) : ensureDesktop()),
    onState: (callback) => {
      if (!isElectron) {
        return () => {};
      }
      return window.argus.exam.onState(callback);
    },
    onTick: (callback) => {
      if (!isElectron) {
        return () => {};
      }
      return window.argus.exam.onTick(callback);
    },
    onWarning: (callback) => {
      if (!isElectron) {
        return () => {};
      }
      return window.argus.exam.onWarning(callback);
    },
  },
  permissions: {
    cameraStatus: () => (isElectron ? unwrap(window.argus.permissions.cameraStatus()) : ensureDesktop()),
    requestCamera: () => (isElectron ? unwrap(window.argus.permissions.requestCamera()) : ensureDesktop()),
    openCameraSettings: () => (isElectron ? unwrap(window.argus.permissions.openCameraSettings()) : ensureDesktop()),
  },
};
