// src/screens/WelcomeScreen.jsx - Candidate registration screen
import { useState } from 'react';

/**
 * Initial candidate intake screen.
 * Captures student identity and dispatches REGISTER_CANDIDATE to the main process.
 */
export default function WelcomeScreen({ candidate = {}, onRegister, error }) {
  const [name, setName] = useState(candidate.name || '');
  const [rollNo, setRollNo] = useState(candidate.rollNo || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onRegister({ name, rollNo });
    } catch {
      // Error is caught and surfaced via the error prop from useExamState
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen-container">
      <div className="card welcome-card">
        <span className="brand-badge">macOS Exam Client</span>
        <h1 className="screen-title">Argus Assessment Portal</h1>
        <p className="screen-subtitle">Please enter your student credentials to begin the examination session.</p>

        {error && (
          <div className="error-banner" role="alert">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 1 0 7 7A7.008 7.008 0 0 0 8 1zm0 11.5a1 1 0 1 1 1-1 1 1 0 0 1-1 1zm.875-4.25a.875.875 0 0 1-1.75 0v-4a.875.875 0 0 1 1.75 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form className="form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="candidate-name" className="form-label">
              Full Name
            </label>
            <input
              id="candidate-name"
              type="text"
              className="form-input"
              placeholder="e.g. Avkash Singh"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="candidate-roll" className="form-label">
              Roll / Registration Number
            </label>
            <input
              id="candidate-roll"
              type="text"
              className="form-input"
              placeholder="e.g. 21BCE1023"
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
              disabled={submitting}
              required
            />
            <span className="form-hint">3–30 alphanumeric characters</span>
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Verifying...' : 'Proceed to Setup'}
          </button>
        </form>
      </div>
    </div>
  );
}
