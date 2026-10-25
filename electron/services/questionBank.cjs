// electron/services/questionBank.cjs - Question bank validation, hashing, import, and sanitization
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dialog } = require('electron');
const storage = require('./storage.cjs');

// Module-level in-memory cache of the currently active question bank
let activeBankData = null;

/**
 * Generates a SHA-256 hex digest of the raw question bank content.
 * The hash identifies the bank by its content, not its file name.
 * @param {string} text
 * @returns {string} SHA-256 hex string
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Validates a candidate question bank object against Argus integrity schema rules:
 * - bankId and title: non-empty strings
 * - questions: 5–200 items
 * - each id: unique non-empty string
 * - text: 1–1000 characters
 * - options: 2–6 unique non-empty strings
 * - answerIndex: integer pointing to an existing option (0 <= answerIndex < options.length)
 * - marks: positive number up to 10 (defaults to 1)
 *
 * @param {any} obj - Parsed JSON object to validate
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateBank(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['Question bank must be a JSON object.'] };
  }

  // 1. Validate top-level bank metadata
  if (typeof obj.bankId !== 'string' || obj.bankId.trim() === '') {
    errors.push('bankId must be a non-empty string.');
  }

  if (typeof obj.title !== 'string' || obj.title.trim() === '') {
    errors.push('title must be a non-empty string.');
  }

  // 2. Validate questions array bounds
  if (!Array.isArray(obj.questions)) {
    errors.push('questions must be an array.');
    return { ok: false, errors };
  }

  const count = obj.questions.length;
  if (count < 5 || count > 200) {
    errors.push(`Question count (${count}) must be between 5 and 200.`);
  }

  const seenIds = new Set();

  // 3. Validate each question definition
  obj.questions.forEach((q, idx) => {
    const qLabel = (q && typeof q.id === 'string' && q.id.trim()) ? q.id.trim() : `Question at index ${idx}`;

    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      errors.push(`${qLabel}: question must be an object.`);
      return;
    }

    // ID validation and uniqueness
    if (typeof q.id !== 'string' || q.id.trim() === '') {
      errors.push(`Question at index ${idx}: id must be a non-empty string.`);
    } else {
      const trimmedId = q.id.trim();
      if (seenIds.has(trimmedId)) {
        errors.push(`${trimmedId}: duplicate question id '${trimmedId}'.`);
      } else {
        seenIds.add(trimmedId);
      }
    }

    // Question text length (1 - 1000 chars)
    if (typeof q.text !== 'string' || q.text.trim().length === 0 || q.text.length > 1000) {
      errors.push(`${qLabel}: text must be between 1 and 1000 characters.`);
    }

    // Options validation (2 - 6 unique non-empty strings)
    if (!Array.isArray(q.options)) {
      errors.push(`${qLabel}: options must be an array.`);
    } else {
      const optCount = q.options.length;
      if (optCount < 2 || optCount > 6) {
        errors.push(`${qLabel}: options count (${optCount}) must be between 2 and 6.`);
      }

      const hasInvalidOption = q.options.some((opt) => typeof opt !== 'string' || opt.trim() === '');
      if (hasInvalidOption) {
        errors.push(`${qLabel}: each option must be a non-empty string.`);
      }

      const uniqueOptions = new Set(q.options.map((opt) => (typeof opt === 'string' ? opt.trim() : '')));
      if (uniqueOptions.size !== q.options.length) {
        errors.push(`${qLabel}: options must all be unique strings.`);
      }

      // answerIndex validation: must be an integer within 0 <= answerIndex < options.length
      const isValidIndex = typeof q.answerIndex === 'number' && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < optCount;
      if (!isValidIndex) {
        errors.push(`${qLabel}: answerIndex ${q.answerIndex} is outside 0–${optCount - 1}.`);
      }
    }

    // Marks validation (positive number up to 10)
    if (q.marks !== undefined) {
      const isValidMarks = typeof q.marks === 'number' && !Number.isNaN(q.marks) && q.marks > 0 && q.marks <= 10;
      if (!isValidMarks) {
        errors.push(`${qLabel}: marks (${q.marks}) must be a positive number up to 10.`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Loads and validates the default question bank bundled with the application.
 * @returns {Object} The loaded bank object
 */
function loadDefaultBank() {
  const filePath = path.join(__dirname, '../data/questions.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  const { ok, errors } = validateBank(parsed);
  if (!ok) {
    throw new Error(`Default question bank validation failed: ${errors.join('; ')}`);
  }

  const hash = hashText(raw);
  activeBankData = {
    bank: parsed,
    hash,
    source: 'default',
    fileName: 'questions.json',
  };

  return activeBankData;
}

/**
 * Returns the currently active question bank in memory.
 * On startup, if settings.activeBank is set: load it, re-hash it, and use it only if
 * the hash still matches. Otherwise fall back to the default bank and clear activeBank.
 *
 * @returns {{ bank: Object, hash: string, source: 'default'|'imported', fileName: string }}
 */
function getActiveBank() {
  if (activeBankData) {
    return activeBankData;
  }

  // Check persistent settings for an active bank
  const settings = storage.getSettings();
  if (settings && settings.activeBank && settings.activeBank.hash) {
    const bankRecord = settings.activeBank;
    const targetFile = storage.getBankPath(bankRecord.hash);

    if (fs.existsSync(targetFile)) {
      try {
        const raw = fs.readFileSync(targetFile, 'utf8');
        const computedHash = hashText(raw);

        if (computedHash === bankRecord.hash) {
          const parsed = JSON.parse(raw);
          const { ok } = validateBank(parsed);
          if (ok) {
            activeBankData = {
              bank: parsed,
              hash: computedHash,
              source: 'imported',
              fileName: bankRecord.fileName || `${bankRecord.hash.slice(0, 8)}.json`,
            };
            return activeBankData;
          }
        }
      } catch (err) {
        console.warn('[QuestionBank] Failed to load persisted active bank:', err);
      }
    }

    // Hash mismatch, file missing, or invalid -> fall back and clear setting
    console.warn('[QuestionBank] Persisted bank hash mismatch or missing file. Falling back to default bank.');
    storage.updateSettingsSync({ activeBank: null });
  }

  return loadDefaultBank();
}

/**
 * Directly updates the active bank data in memory (e.g. during crash recovery).
 * @param {Object} bankData
 */
function setActiveBankData(bankData) {
  if (bankData && bankData.bank && bankData.hash) {
    activeBankData = bankData;
  }
}

/**
 * Looks up a question bank by its SHA-256 hash.
 * 1. Checks current activeBankData.
 * 2. Checks bundled default bank.
 * 3. Checks storage banks/<hash>.json.
 *
 * @param {string} hash
 * @returns {{ bank: Object, hash: string, source: string, fileName: string }|null}
 */
function getBankByHash(hash) {
  if (!hash || typeof hash !== 'string') {
    return null;
  }

  // 1. In-memory active bank
  if (activeBankData && activeBankData.hash === hash) {
    return activeBankData;
  }

  // 2. Bundled default bank
  try {
    const defaultBank = loadDefaultBank();
    if (defaultBank && defaultBank.hash === hash) {
      return defaultBank;
    }
  } catch (err) {
    console.warn('[QuestionBank] Failed checking default bank by hash:', err);
  }

  // 3. Stored bank file in userData/banks/<hash>.json
  const filePath = storage.getBankPath(hash);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const computedHash = hashText(raw);
      if (computedHash === hash) {
        const parsed = JSON.parse(raw);
        const { ok } = validateBank(parsed);
        if (ok) {
          return {
            bank: parsed,
            hash: computedHash,
            source: 'imported',
            fileName: `${hash.slice(0, 8)}.json`,
          };
        }
      }
    } catch (err) {
      console.warn(`[QuestionBank] Error loading bank ${hash} from disk:`, err);
    }
  }

  return null;
}

/**
 * Sanitizes a question bank for transmission to the untrusted renderer process.
 * The renderer is untrusted, so the answer key (answerIndex) never leaves the main process.
 *
 * @param {Object} bank - The raw question bank containing answerIndex
 * @param {string[]} [order] - Optional array of question IDs defining session order
 * @returns {Array<{ id: string, text: string, options: string[], marks: number }>}
 */
function toPublicQuestions(bank, order) {
  if (!bank || !Array.isArray(bank.questions)) {
    return [];
  }

  const questionMap = new Map(bank.questions.map((q) => [q.id, q]));
  const ids = Array.isArray(order) && order.length > 0 ? order : bank.questions.map((q) => q.id);

  return ids
    .map((id) => questionMap.get(id))
    .filter(Boolean)
    .map((q) => ({
      id: q.id,
      text: q.text,
      options: [...q.options],
      marks: typeof q.marks === 'number' ? q.marks : 1,
    }));
}

/**
 * Prompts the examiner to select and import a question bank JSON file.
 * Allowed only when the exam state machine is in 'welcome' or 'setup'.
 * After a successful import:
 * - Copies the validated JSON to banks/<sha256>.json.
 * - Updates settings.activeBank = { path, hash, fileName }.
 *
 * @param {Electron.BrowserWindow} win - Parent window for the file dialog
 * @returns {Promise<{ ok: boolean, title?: string, count?: number, hashShort?: string, canceled?: boolean, errors?: string[] }>}
 */
async function importBank(win) {
  // Lazy require to avoid circular dependencies
  const { examStore } = require('../core/examStore.cjs');

  if (examStore.state.phase !== 'welcome' && examStore.state.phase !== 'setup') {
    const err = new Error(`Importing question bank is not allowed during '${examStore.state.phase}' phase.`);
    err.code = 'INVALID_PHASE';
    throw err;
  }

  const result = await dialog.showOpenDialog(win, {
    title: 'Import question bank',
    properties: ['openFile'],
    filters: [{ name: 'Question bank', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];

  // Check file size (max 1 MB)
  const stats = await fs.promises.stat(filePath);
  if (stats.size > 1024 * 1024) {
    const err = new Error('Selected question bank exceeds maximum size limit of 1 MB.');
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  // Read file contents
  const raw = await fs.promises.readFile(filePath, 'utf8');

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('The selected file contains invalid JSON syntax.');
    err.code = 'INVALID_JSON';
    throw err;
  }

  // Validate question bank integrity
  const { ok, errors } = validateBank(parsed);
  if (!ok) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Invalid question bank',
      message: 'The selected question bank failed validation:',
      detail: errors.slice(0, 5).join('\n'),
      buttons: ['OK'],
    });
    return { ok: false, errors };
  }

  // Valid bank: compute hash and persist to storage
  const hash = hashText(raw);
  const fileName = path.basename(filePath);
  const savedPath = storage.saveBank(hash, parsed);

  // Update persistent settings
  await storage.updateSettings({
    activeBank: {
      path: savedPath,
      hash,
      fileName,
    },
  });

  activeBankData = {
    bank: parsed,
    hash,
    source: 'imported',
    fileName,
  };

  // Notify any store listeners of updated bank metadata
  examStore.emit('bank-changed', getActiveBankSummary());

  return {
    ok: true,
    title: parsed.title,
    count: parsed.questions.length,
    hashShort: hash.slice(0, 8),
  };
}

/**
 * Returns a summary of the active bank suitable for display in setup and IPC.
 * @returns {{ title: string, count: number, source: string, fileName: string, hashShort: string }}
 */
function getActiveBankSummary() {
  const active = getActiveBank();
  return {
    title: active.bank.title,
    count: active.bank.questions.length,
    source: active.source,
    fileName: active.fileName,
    hashShort: active.hash.slice(0, 8),
  };
}

module.exports = {
  validateBank,
  hashText,
  loadDefaultBank,
  getActiveBank,
  getActiveBankSummary,
  getBankByHash,
  setActiveBankData,
  toPublicQuestions,
  importBank,
};
