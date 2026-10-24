// src/screens/SetupScreen.jsx - Pre-exam verification and environment readiness check
import { useState } from 'react';

/**
 * Setup and environmental readiness screen.
 * Displays verification checklist and allows the student to launch the exam or return back.
 */
export default function SetupScreen({ candidate, examTitle, durationMs, onStart, onBack, error }) {
  const [starting, setStarting] = useState(false);
  const durationMinutes = Math.round(durationMs / 60000);

  const handleStart = async () => {
    setStarting(true);
    try {
      await onStart();
    } catch {
      // Handled via error state
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="screen-container">
      <div className="card setup-card">
        <span className="brand-badge">Pre-Flight Checklist</span>
        <h1 className="screen-title">{examTitle || 'Exam Setup'}</h1>
        <p className="screen-subtitle">Please verify your details and review the assessment instructions before starting.</p>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="candidate-summary">
          <div className="summary-item">
            <span className="summary-label">Candidate Name:</span>
            <span className="summary-value">{candidate?.name || '—'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Roll Number:</span>
            <span className="summary-value">{candidate?.rollNo || '—'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Exam Duration:</span>
            <span className="summary-value">{durationMinutes} Minutes</span>
          </div>
        </div>

        <div className="checklist">
          <div className="checklist-item">
            <span className="check-icon">✓</span>
            <div>
              <strong>Single Display Environment:</strong> Ensure external displays are disconnected.
            </div>
          </div>
          <div className="checklist-item">
            <span className="check-icon">✓</span>
            <div>
              <strong>Background Applications:</strong> Unauthorized communication tools must remain closed.
            </div>
          </div>
          <div className="checklist-item">
            <span className="check-icon">✓</span>
            <div>
              <strong>Drift-Free Proctoring:</strong> The countdown timer runs server-side in the main process.
            </div>
          </div>
        </div>

        <div className="btn-group">
          <button type="button" className="btn btn-secondary" onClick={onBack} disabled={starting}>
            Back
          </button>
          <button type="button" className="btn btn-primary" onClick={handleStart} disabled={starting}>
            {starting ? 'Initializing Session...' : 'Start Exam'}
          </button>
        </div>
      </div>
    </div>
  );
}
