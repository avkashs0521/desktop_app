// src/hooks/useRemainingTime.js - Hook to subscribe to main-process countdown timer ticks
import { useState, useEffect } from 'react';
import { api, isElectron } from '../api';

/**
 * Subscribes to drift-free exam countdown ticks pushed from the main process.
 * @param {number} [initialDurationMs=0] - Initial duration fallback
 * @returns {number} remainingMs
 */
export function useRemainingTime(initialDurationMs = 0) {
  const [remainingMs, setRemainingMs] = useState(initialDurationMs);

  useEffect(() => {
    if (!isElectron) return;

    const unsubscribe = api.exam.onTick((payload) => {
      if (payload && typeof payload.remainingMs === 'number') {
        setRemainingMs(payload.remainingMs);
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  return remainingMs;
}
