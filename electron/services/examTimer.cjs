// electron/services/examTimer.cjs - Drift-free wall-clock exam countdown timer

const { sendToRenderer } = require('../window.cjs');
const { CHANNELS } = require('../ipc/channels.cjs');

/**
 * Starts the countdown timer against a fixed wall-clock end timestamp.
 *
 * DESIGN NOTE:
 * We compare against the wall-clock endsAt (Math.max(0, endsAt - Date.now())) instead of
 * decrementing a tick counter. This guarantees:
 * 1. Zero drift, even if the OS throttles setInterval or background tasks delay execution.
 * 2. Exact synchronization across renderer reloads (e.g. Cmd+R) — remaining time is recomputed immediately.
 * 3. Immunity from client tampering since calculation lives entirely in Node.js.
 * (This also resolves the class project's 60 * 60 * 60 calculation bug.)
 *
 * @param {number} endsAt - Absolute UNIX timestamp (ms) when the exam ends.
 * @param {Object} scope - Lifecycle resource scope that owns this timer.
 * @param {Function} [dispatchTimeUp] - Optional callback to trigger TIME_UP command.
 */
function start(endsAt, scope, dispatchTimeUp) {
  const checkTick = () => {
    const remainingMs = Math.max(0, endsAt - Date.now());

    // Push tick to renderer
    sendToRenderer(CHANNELS.EXAM_TICK, { remainingMs });

    if (remainingMs === 0) {
      if (typeof dispatchTimeUp === 'function') {
        dispatchTimeUp();
      } else {
        // Fallback lazy import if callback wasn't supplied directly
        const { examStore } = require('../core/examStore.cjs');
        examStore.dispatch('TIME_UP', { source: 'main' }).catch((err) => {
          console.error('[ExamTimer] Error dispatching TIME_UP:', err);
        });
      }
    }
  };

  // Push immediate initial tick so UI displays time without waiting 1000ms
  checkTick();

  // Schedule regular 1-second ticks tracked deterministically by the exam scope
  scope.interval(checkTick, 1000);
}

module.exports = {
  start,
};
