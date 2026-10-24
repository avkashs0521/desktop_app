// src/screens/ExamScreen.jsx - Active exam assessment screen
import { useState } from 'react';
import { useRemainingTime } from '../hooks/useRemainingTime';
import { formatDuration } from '../utils/formatTime';

/**
 * Active examination screen.
 * Displays the exam title, live main-process countdown clock, and submission trigger.
 */
export default function ExamScreen({ examTitle, durationMs, candidate, onSubmit, error }) {
  const remainingMs = useRemainingTime(durationMs);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit();
    } catch {
      // Handled via error state
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen-container">
      <div className="card exam-card">
        <header className="exam-header">
          <div>
            <span className="brand-badge">Session In Progress</span>
            <h1 className="screen-title">{examTitle || 'Active Examination'}</h1>
            <p className="screen-subtitle">Candidate: {candidate?.name} ({candidate?.rollNo})</p>
          </div>

          <div className="timer-box" aria-label="Remaining Exam Time">
            <span className="timer-label">Time Remaining</span>
            <span className="timer-countdown">{formatDuration(remainingMs)}</span>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="exam-placeholder">
          <p className="placeholder-text">Exam questions and answer grid arrive in Commit 4.</p>
          <div className="placeholder-meta">
            <span>Wall-clock drift-free timer active</span>
            <span>Reload-safe state retention verified</span>
          </div>
        </div>

        <div className="exam-actions">
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Exam'}
          </button>
        </div>
      </div>
    </div>
  );
}
