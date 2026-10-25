// electron/core/autosave.cjs - Debounced state autosave and shutdown flush manager
const storage = require('../services/storage.cjs');

let debounceTimer = null;
let currentExamStore = null;

/**
 * Saves current session state asynchronously.
 * Only persists sessions once candidate registration has commenced.
 * @param {Object} state
 */
async function triggerSave(state) {
  if (!state || !state.sessionId || state.phase === 'welcome') {
    return;
  }
  try {
    await storage.saveSession(state);
  } catch (err) {
    console.error('[Autosave] Failed to autosave session:', err);
  }
}

/**
 * Initializes autosave listeners for the provided examStore instance.
 * - 'change': Debounced at 400ms to avoid disk thrashing during rapid answer clicks.
 * - 'phase': Saved immediately to guarantee state transitions are durable.
 *
 * @param {import('./examStore.cjs').ExamStore} store
 */
function initAutosave(store) {
  currentExamStore = store;

  store.on('change', (state) => {
    // Only autosave active or submitted sessions
    if (!state || !state.sessionId || state.phase === 'welcome') {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      triggerSave(store.state);
    }, 400);
  });

  store.on('phase', () => {
    // Phase transitions flush immediately
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    triggerSave(store.state);
  });
}

/**
 * Synchronously flushes any pending debounced state to disk before process exit.
 * Called during app shutdown / before-quit.
 */
function flushSync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (currentExamStore && currentExamStore.state && currentExamStore.state.sessionId && currentExamStore.state.phase !== 'welcome') {
    try {
      storage.saveSessionSync(currentExamStore.state);
    } catch (err) {
      console.error('[Autosave] Failed to flush session during shutdown:', err);
    }
  }
}

module.exports = {
  initAutosave,
  flushSync,
};
