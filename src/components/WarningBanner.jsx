// src/components/WarningBanner.jsx - Low-time warning overlay pushed from main process
import { useState, useEffect } from 'react';
import { api, isElectron } from '../api';

/**
 * Subscribes to main-process warning events (exam:warning) and briefly shows
 * a coloured alert banner when time crosses a configured threshold.
 *
 * Design: The banner auto-dismisses after 8 seconds. It also shows a persistent
 * pill in the timer area when fewer than 5 minutes remain.
 */
export default function WarningBanner() {
  const [warning, setWarning] = useState(null); // { minutesLeft: number } | null

  useEffect(() => {
    if (!isElectron) return;

    const unsubscribe = api.exam.onWarning((payload) => {
      if (payload && typeof payload.minutesLeft === 'number') {
        setWarning(payload);

        // Auto-dismiss the banner after 8 seconds so it doesn't block the UI
        setTimeout(() => {
          setWarning((current) => (current?.minutesLeft === payload.minutesLeft ? null : current));
        }, 8000);
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  if (!warning) return null;

  // Decide urgency colour based on minutes remaining
  const isUrgent = warning.minutesLeft <= 1;

  return (
    <div
      className={`warning-banner ${isUrgent ? 'warning-banner--urgent' : 'warning-banner--caution'}`}
      role="alert"
      aria-live="assertive"
    >
      <span className="warning-banner__icon" aria-hidden="true">
        {isUrgent ? '🚨' : '⚠️'}
      </span>
      <span className="warning-banner__text">
        {isUrgent
          ? 'Only 1 minute remaining! Submit now if you are done.'
          : `${warning.minutesLeft} minutes remaining. Please review your answers.`}
      </span>
      <button
        type="button"
        className="warning-banner__dismiss"
        onClick={() => setWarning(null)}
        aria-label="Dismiss warning"
      >
        ✕
      </button>
    </div>
  );
}
