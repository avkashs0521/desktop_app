// electron/core/lifecycle.cjs - Resource scope manager for deterministic cleanup of timers and subscriptions

/**
 * Creates a named lifecycle scope that tracks disposable resources (timers, event listeners).
 * Enables clean teardown to prevent memory leaks and zombie intervals across phase transitions.
 * @param {string} name - Identifying name for logging and debugging.
 */
function createScope(name = 'scope') {
  let disposers = [];
  let disposed = false;

  /**
   * Tracks a cleanup/disposer function to be executed when the scope is torn down.
   * @param {Function} disposeFn
   * @returns {Function} Function to untrack early if manually disposed.
   */
  function track(disposeFn) {
    if (typeof disposeFn !== 'function') {
      throw new TypeError(`Scope track requires a function, got ${typeof disposeFn}`);
    }

    if (disposed) {
      try {
        disposeFn();
      } catch (err) {
        console.error(`[Scope: ${name}] Error executing immediate disposer:`, err);
      }
      return () => {};
    }

    disposers.push(disposeFn);
    return () => {
      disposers = disposers.filter((fn) => fn !== disposeFn);
    };
  }

  /**
   * Creates an interval tracked by this scope.
   * @param {Function} fn
   * @param {number} ms
   * @returns {NodeJS.Timeout | null}
   */
  function interval(fn, ms) {
    if (disposed) return null;
    const timerId = setInterval(fn, ms);
    track(() => clearInterval(timerId));
    return timerId;
  }

  /**
   * Creates a timeout tracked by this scope.
   * @param {Function} fn
   * @param {number} ms
   * @returns {NodeJS.Timeout | null}
   */
  function timeout(fn, ms) {
    if (disposed) return null;
    const timerId = setTimeout(fn, ms);
    track(() => clearTimeout(timerId));
    return timerId;
  }

  /**
   * Disposes all tracked resources in reverse order of registration (LIFO).
   * Safe to call multiple times.
   */
  function dispose() {
    if (disposed) return;
    disposed = true;

    // Run disposers in reverse order (newest to oldest)
    const activeDisposers = [...disposers].reverse();
    disposers = [];

    for (const disposeFn of activeDisposers) {
      try {
        disposeFn();
      } catch (err) {
        console.error(`[Scope: ${name}] Disposer failed during cleanup:`, err);
      }
    }
  }

  return {
    name,
    track,
    interval,
    timeout,
    dispose,
    isDisposed: () => disposed,
  };
}

// Global application scope disposed on application quit
const appScope = createScope('appScope');

module.exports = {
  createScope,
  appScope,
};
