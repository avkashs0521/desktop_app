// src/screens/ResultScreen.jsx - Post-exam summary and termination screen

/**
 * Result and completion screen.
 * Displays submission status, termination reasons, score, answered totals, and reset action.
 */
export default function ResultScreen({ state, onReset }) {
  const isTerminated = state.phase === 'terminated';
  const result = state.result || {};
  const { answeredCount = 0, correctCount, totalCount, scorePercent } = result;
  const hasScore = typeof correctCount === 'number' && typeof totalCount === 'number';
  const reason = state.submitReason || 'manual';

  const reasonLabels = {
    manual: 'Manual candidate submission',
    time_up: 'Allocated exam time expired (automatic submission)',
    violation_limit: 'Exceeded maximum permitted security violations',
    terminated: 'Terminated by proctoring supervisor',
  };

  const statusTitle = isTerminated ? 'Assessment Terminated' : 'Assessment Completed';
  const statusDescription = isTerminated
    ? 'This examination session was halted due to a security violation or administrator action.'
    : 'Your exam answers have been securely logged in the main process.';

  // Determine score colour class
  const scoreClass =
    !hasScore ? '' : scorePercent >= 75 ? 'score--pass' : scorePercent >= 50 ? 'score--warn' : 'score--fail';

  return (
    <div className="screen-container">
      <div className="card result-card">
        <span className={`brand-badge ${isTerminated ? 'badge-danger' : 'badge-success'}`}>
          {isTerminated ? 'Session Terminated' : 'Session Finalized'}
        </span>

        <h1 className="screen-title">{statusTitle}</h1>
        <p className="screen-subtitle">{statusDescription}</p>

        <div className="result-stats">
          <div className="stat-card">
            <span className="stat-label">Candidate</span>
            <span className="stat-value">{state.candidate?.name || '—'}</span>
            <span className="stat-sub">{state.candidate?.rollNo}</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Submission Cause</span>
            <span className="stat-value">{reasonLabels[reason] || reason}</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Answers Logged</span>
            <span className="stat-value stat-number">{answeredCount}{hasScore ? ` / ${totalCount}` : ''}</span>
          </div>

          {/* Score card — only shown when grading data is available */}
          {hasScore && (
            <div className={`stat-card score-card ${scoreClass}`}>
              <span className="stat-label">Score</span>
              <span className="stat-value stat-number score-number">
                {correctCount} / {totalCount}
              </span>
              <span className="stat-sub">{scorePercent}%</span>
            </div>
          )}
        </div>

        <div className="result-actions">
          <button type="button" className="btn btn-primary" onClick={onReset}>
            Start a new attempt
          </button>
        </div>
      </div>
    </div>
  );
}
