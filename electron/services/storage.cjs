// electron/services/storage.cjs - Local persistence with atomic writes, settings, sessions, and crash recovery
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// Storage directory roots located in the standard OS user-data directory:
// macOS: ~/Library/Application Support/Argus
const baseDir = app && typeof app.getPath === 'function'
  ? app.getPath('userData')
  : path.join(process.cwd(), '.argus-userData');

const sessionsDir = path.join(baseDir, 'sessions');
const banksDir = path.join(baseDir, 'banks');
const proctorDir = path.join(baseDir, 'proctor');
const logsDir = path.join(baseDir, 'logs');
const settingsFile = path.join(baseDir, 'settings.json');

// Initialize directory tree synchronously on module load
function ensureStorageDirectories() {
  [baseDir, sessionsDir, banksDir, proctorDir, logsDir].forEach((dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error(`[Storage] Failed to initialize directory: ${dir}`, err);
    }
  });
}

ensureStorageDirectories();

/**
 * Safely reads and parses a JSON file from disk.
 * - Missing file: returns the provided fallback without error.
 * - Unparseable / corrupt JSON: preserves the file by renaming it to
 *   <name>.corrupt-<timestamp>.json, logs a warning, and returns fallback.
 *   This guarantees the application never crashes due to a corrupt config or state file.
 *
 * @param {string} filePath - Absolute path to the JSON file
 * @param {any} [fallback=null] - Default return value on missing or corrupt file
 * @returns {any} Parsed JSON or fallback
 */
function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    const parsedPath = path.parse(filePath);
    const corruptFile = path.join(
      parsedPath.dir,
      `${parsedPath.name}.corrupt-${Date.now()}${parsedPath.ext}`
    );

    try {
      fs.renameSync(filePath, corruptFile);
      console.warn(`[Storage] Corrupt JSON in ${filePath}. Renamed to ${corruptFile}: ${err.message}`);
    } catch (renameErr) {
      console.warn(`[Storage] Failed to rename corrupt file ${filePath}:`, renameErr);
    }

    return fallback;
  }
}

/**
 * Writes data to a file atomically using asynchronous filesystem promises.
 * Strategy:
 * 1. Write content to a temporary sibling file (<filePath>.tmp).
 * 2. Perform fs.rename() to atomically replace the target file.
 *
 * ATOMIC WRITE NOTE:
 * On POSIX operating systems (macOS/Linux) and Windows, renaming a file within
 * the same filesystem volume is an atomic operation guaranteed by the OS kernel.
 * If the application crashes, the power cuts out, or the process is killed mid-write,
 * the original file remains completely intact and valid — avoiding half-written or empty files.
 *
 * @param {string} filePath
 * @param {any} data
 * @returns {Promise<void>}
 */
async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const jsonStr = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmpPath, jsonStr, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Synchronous atomic writer used exclusively for final flushing during app shutdown or quit.
 * Standard event loop async I/O cannot be guaranteed to complete once app.quit() is invoked.
 *
 * @param {string} filePath
 * @param {any} data
 */
function writeJsonAtomicSync(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  const jsonStr = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, jsonStr, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ==========================================
// Settings Management
// ==========================================

const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  theme: 'system',
  candidate: { name: '', rollNo: '' },
  activeBank: null, // { path: string, hash: string, fileName: string }
});

const KNOWN_SETTINGS_KEYS = Object.freeze(['theme', 'candidate', 'activeBank']);

/**
 * Migrates settings data structure forward across schema versions.
 * WHY MIGRATIONS ARE ESSENTIAL:
 * When desktop applications update, old persisted configurations may lack new keys
 * or use obsolete schemas. Version-keyed migrations allow seamless schema upgrades
 * without wiping student credentials or user preferences.
 *
 * @param {Object} rawSettings
 * @returns {Object} Migrated settings
 */
function migrate(rawSettings) {
  if (!rawSettings || typeof rawSettings !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const currentVersion = rawSettings.schemaVersion || 0;
  let settings = { ...rawSettings };

  // Version 1: Baseline schema for Argus 1.0
  if (currentVersion < 1) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      schemaVersion: 1,
    };
  }

  return settings;
}

/**
 * Retrieves the current user settings from settings.json.
 * @returns {Object} Settings object conforming to current schemaVersion
 */
function getSettings() {
  const data = readJson(settingsFile, null);
  if (!data) {
    const initial = { ...DEFAULT_SETTINGS };
    try {
      writeJsonAtomicSync(settingsFile, initial);
    } catch (err) {
      console.warn('[Storage] Failed to write initial settings.json:', err);
    }
    return initial;
  }
  return migrate(data);
}

/**
 * Updates settings with partial values, strictly accepting only known keys.
 *
 * @param {Object} partial - Settings delta containing only allowed keys
 * @returns {Promise<Object>} The updated settings
 */
async function updateSettings(partial = {}) {
  const current = getSettings();
  const filteredPartial = {};

  KNOWN_SETTINGS_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      filteredPartial[key] = partial[key];
    }
  });

  const updated = {
    ...current,
    ...filteredPartial,
    schemaVersion: 1,
  };

  await writeJsonAtomic(settingsFile, updated);
  return updated;
}

/**
 * Synchronous settings updater for shutdown/cleanup hooks.
 * @param {Object} partial
 * @returns {Object}
 */
function updateSettingsSync(partial = {}) {
  const current = getSettings();
  const filteredPartial = {};

  KNOWN_SETTINGS_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      filteredPartial[key] = partial[key];
    }
  });

  const updated = {
    ...current,
    ...filteredPartial,
    schemaVersion: 1,
  };

  writeJsonAtomicSync(settingsFile, updated);
  return updated;
}

// ==========================================
// Session Persistence & Recovery
// ==========================================

/**
 * Persists an exam session to disk (sessions/<sessionId>.json).
 * @param {Object} sessionState - State snapshot to save
 * @returns {Promise<string>} Path to saved session file
 */
async function saveSession(sessionState) {
  if (!sessionState || !sessionState.sessionId) {
    return null;
  }
  const sessionPath = path.join(sessionsDir, `${sessionState.sessionId}.json`);
  await writeJsonAtomic(sessionPath, sessionState);
  return sessionPath;
}

/**
 * Synchronous session save for immediate quit flush.
 * @param {Object} sessionState
 * @returns {string|null}
 */
function saveSessionSync(sessionState) {
  if (!sessionState || !sessionState.sessionId) {
    return null;
  }
  const sessionPath = path.join(sessionsDir, `${sessionState.sessionId}.json`);
  writeJsonAtomicSync(sessionPath, sessionState);
  return sessionPath;
}

/**
 * Loads a full session by its session ID.
 * @param {string} sessionId
 * @returns {Object|null}
 */
function loadSession(sessionId) {
  if (!sessionId) return null;
  const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
  return readJson(sessionPath, null);
}

/**
 * Lists all stored exam sessions sorted newest first.
 * Returns only clean summary objects to minimize IPC overhead.
 *
 * @returns {Array<Object>} Summaries of persisted sessions
 */
function listSessions() {
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  let files;
  try {
    files = fs.readdirSync(sessionsDir);
  } catch (err) {
    console.warn('[Storage] Failed to read sessions directory:', err);
    return [];
  }

  const summaries = [];

  files.forEach((file) => {
    // Ignore temporary, corrupt, or hidden files
    if (!file.endsWith('.json') || file.includes('.tmp') || file.includes('.corrupt')) {
      return;
    }

    const fullPath = path.join(sessionsDir, file);
    const session = readJson(fullPath, null);
    if (!session || typeof session !== 'object') {
      return;
    }

    const answeredCount = session.answers && typeof session.answers === 'object'
      ? Object.keys(session.answers).length
      : 0;

    summaries.push({
      id: session.sessionId || path.basename(file, '.json'),
      candidate: session.candidate || { name: '', rollNo: '' },
      phase: session.phase || 'welcome',
      startedAt: session.startedAt || null,
      submittedAt: session.submittedAt || null,
      submitReason: session.submitReason || null,
      answeredCount,
      result: session.result || null,
      examTitle: session.examTitle || '',
    });
  });

  // Sort newest first by startedAt or submittedAt descending
  summaries.sort((a, b) => {
    const timeA = a.startedAt || a.submittedAt || 0;
    const timeB = b.startedAt || b.submittedAt || 0;
    return timeB - timeA;
  });

  return summaries;
}

/**
 * Searches for the newest session that was abruptly interrupted while in_progress.
 * Used at startup to prompt candidate for crash/quit recovery.
 *
 * @returns {Object|null} Full session state if found, or null
 */
function findUnfinishedSession() {
  const summaries = listSessions();
  const unfinishedSummary = summaries.find((s) => s.phase === 'in_progress');
  if (!unfinishedSummary) {
    return null;
  }
  return loadSession(unfinishedSummary.id);
}

// ==========================================
// Question Bank Persistence
// ==========================================

/**
 * Copies and persists an imported question bank into banks/<hash>.json.
 * @param {string} hash - SHA-256 hash of the bank content
 * @param {Object} bankData - Parsed and validated question bank object
 * @returns {string} Absolute path to the stored bank file
 */
function saveBank(hash, bankData) {
  const bankFilePath = path.join(banksDir, `${hash}.json`);
  writeJsonAtomicSync(bankFilePath, bankData);
  return bankFilePath;
}

/**
 * Returns the path to a stored bank file by its SHA-256 hash.
 * @param {string} hash
 * @returns {string} Absolute path
 */
function getBankPath(hash) {
  return path.join(banksDir, `${hash}.json`);
}

module.exports = {
  baseDir,
  sessionsDir,
  banksDir,
  proctorDir,
  logsDir,
  settingsFile,
  readJson,
  writeJsonAtomic,
  writeJsonAtomicSync,
  getSettings,
  updateSettings,
  updateSettingsSync,
  saveSession,
  saveSessionSync,
  loadSession,
  listSessions,
  findUnfinishedSession,
  saveBank,
  getBankPath,
};
