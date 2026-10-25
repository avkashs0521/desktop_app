// src/screens/WelcomeScreen.jsx - Candidate registration and attempts history screen
import { useState, useEffect } from 'react';
import { api, isElectron } from '../api';

/**
 * Initial candidate intake screen.
 * Captures student identity and dispatches REGISTER_CANDIDATE to the main process.
 * Prefills credentials from persisted settings and displays the last 5 exam attempts.
 */
export default function WelcomeScreen({ candidate = {}, onRegister, error }) {
  const [name, setName] = useState(candidate.name || '');
  const [rollNo, setRollNo] = useState(candidate.rollNo || '');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Load persisted candidate defaults and session history on mount
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!isElectron) {
        setHistoryLoading(false);
        return;
      }

      try {
        const [settings, sessions] = await Promise.all([
          api.settings.get().catch(() => null),
          api.history.list().catch(() => []),
        ]);

        if (isMounted) {
          if (settings?.candidate) {
            if (settings.candidate.name) {
              setName((prev) => (prev ? prev : settings.candidate.name));
            }
            if (settings.candidate.rollNo) {
              setRollNo((prev) => (prev ? prev : settings.candidate.rollNo));
            }
          }
          if (Array.isArray(sessions)) {
            setHistory(sessions.slice(0, 5));
          }
        }
      } catch (err) {
        console.warn('[WelcomeScreen] Failed to load settings or history:', err);
      } finally {
        if (isMounted) {
          setHistoryLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

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

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown date';
    const d = new Date(timestamp);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatStatus = (session) => {
    const phase = session.phase;
    const reason = session.submitReason;

    if (phase === 'submitted') {
      return reason ? `Submitted (${reason})` : 'Submitted';
    }
    if (phase === 'terminated') {
      return reason ? `Terminated (${reason})` : 'Terminated';
    }
    if (phase === 'in_progress') {
      return 'Incomplete';
    }
    return phase || 'Unknown';
  };

  const getStatusBadgeClass = (phase) => {
    if (phase === 'submitted') return 'history-badge-success';
    if (phase === 'terminated') return 'history-badge-danger';
    return 'history-badge-warning';
  };

  return (
    <div className="screen-container welcome-container">
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

      {/* Previous attempts card */}
      <div className="card history-card">
        <div className="history-header">
          <h2 className="history-title">Previous attempts</h2>
          <span className="history-count">{history.length} recent</span>
        </div>

        {historyLoading ? (
          <p className="history-empty">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="history-empty">No attempts yet</p>
        ) : (
          <ul className="history-list">
            {history.map((s) => (
              <li key={s.id} className="history-item">
                <div className="history-item-left">
                  <span className="history-date">{formatDate(s.startedAt || s.submittedAt)}</span>
                  <span className={`history-badge ${getStatusBadgeClass(s.phase)}`}>
                    {formatStatus(s)}
                  </span>
                </div>
                <div className="history-item-right">
                  <span className="history-answered">
                    {s.answeredCount} question{s.answeredCount === 1 ? '' : 's'} answered
                  </span>
                  {s.result && typeof s.result.scorePercent === 'number' && (
                    <span className="history-score">{s.result.scorePercent}%</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
