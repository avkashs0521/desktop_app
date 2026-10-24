// src/screens/ExamScreen.jsx - Active exam assessment screen with question navigation and answer selection
import { useState } from 'react';
import { useRemainingTime } from '../hooks/useRemainingTime';
import { formatDuration } from '../utils/formatTime';
import WarningBanner from '../components/WarningBanner';

/**
 * Active examination screen.
 *
 * Displays:
 * - A question sidebar navigator with answered/review/unanswered states
 * - The current question with four option radio buttons
 * - A bottom navigation bar (Previous / Next) and a Submit Exam button
 * - The drift-free countdown timer from the main process
 * - Low-time warning banners from WarningBanner
 *
 * All answer saving and review toggling are dispatched through the exam
 * state machine command `SAVE_ANSWER` and `TOGGLE_REVIEW` via the `send` prop.
 *
 * @param {Object} props
 * @param {string} props.examTitle
 * @param {number} props.durationMs - Initial duration for fallback display
 * @param {Object} props.candidate
 * @param {Array}  props.questions - Shuffled question array from exam state
 * @param {Object} props.answers   - Map of { questionId: optionIndex }
 * @param {Array}  props.review    - Array of flagged question IDs
 * @param {Function} props.onSubmit
 * @param {Function} props.send    - State machine dispatcher from useExamState
 * @param {string|null} props.error
 */
export default function ExamScreen({
  examTitle,
  durationMs,
  candidate,
  questions = [],
  answers = {},
  review = [],
  onSubmit,
  send,
  error,
}) {
  const remainingMs = useRemainingTime(durationMs);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;

  // Derived counts for the top status bar
  const answeredCount = Object.keys(answers).length;
  const reviewCount = review.length;
  const unansweredCount = totalQuestions - answeredCount;

  // Remaining time urgency for visual cue (less than 5 minutes)
  const isLowTime = remainingMs > 0 && remainingMs < 5 * 60 * 1000;
  const isCriticalTime = remainingMs > 0 && remainingMs < 60 * 1000;

  /** Handle selecting an option: dispatches SAVE_ANSWER to main process */
  const handleSelectOption = (optionIndex) => {
    if (!currentQuestion) return;
    send('SAVE_ANSWER', { questionId: currentQuestion.id, optionIndex }).catch(() => {});
  };

  /** Handle toggling the review flag for the current question */
  const handleToggleReview = () => {
    if (!currentQuestion) return;
    send('TOGGLE_REVIEW', { questionId: currentQuestion.id }).catch(() => {});
  };

  /** Confirmed submission: dispatch SUBMIT_EXAM to main process */
  const handleSubmit = async () => {
    setShowConfirm(false);
    setSubmitting(true);
    try {
      await onSubmit();
    } catch {
      // Error surfaces via the error prop from useExamState
    } finally {
      setSubmitting(false);
    }
  };

  /** Get the visual state class for a sidebar question pill */
  const getPillClass = (q, idx) => {
    const isActive = idx === currentIndex;
    const isAnswered = answers[q.id] !== undefined;
    const isReview = review.includes(q.id);

    if (isActive) return 'q-pill q-pill--active';
    if (isReview) return 'q-pill q-pill--review';
    if (isAnswered) return 'q-pill q-pill--answered';
    return 'q-pill q-pill--unanswered';
  };

  if (!currentQuestion) {
    return (
      <div className="screen-container">
        <div className="card exam-card">
          <p className="screen-subtitle">No questions available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-container exam-screen-layout">
      {/* ── Warning banner rendered at the top of the exam screen ── */}
      <WarningBanner />

      {/* ── Top header bar ── */}
      <header className="exam-header-bar">
        <div className="exam-header-left">
          <span className="brand-badge">Session In Progress</span>
          <span className="exam-title-inline">{examTitle || 'Assessment'}</span>
          <span className="exam-candidate-inline">
            {candidate?.name} · {candidate?.rollNo}
          </span>
        </div>

        <div className="exam-header-right">
          {/* Progress counts */}
          <span className="exam-progress-badge">
            {answeredCount}/{totalQuestions} answered
          </span>
          {reviewCount > 0 && (
            <span className="exam-progress-badge review-badge">{reviewCount} flagged</span>
          )}

          {/* Countdown timer */}
          <div
            className={`timer-box ${isLowTime ? 'timer-box--warning' : ''} ${isCriticalTime ? 'timer-box--critical' : ''}`}
            aria-label="Remaining Exam Time"
          >
            <span className="timer-label">Time</span>
            <span className="timer-countdown">{formatDuration(remainingMs)}</span>
          </div>
        </div>
      </header>

      {/* ── Main two-column layout: sidebar + question panel ── */}
      <div className="exam-body">
        {/* Left sidebar: question grid navigator */}
        <aside className="exam-sidebar">
          <p className="sidebar-heading">Questions</p>
          <div className="q-grid">
            {questions.map((q, idx) => (
              <button
                key={q.id}
                type="button"
                className={getPillClass(q, idx)}
                onClick={() => setCurrentIndex(idx)}
                title={`Question ${idx + 1}${review.includes(q.id) ? ' (Flagged)' : ''}`}
                aria-current={idx === currentIndex ? 'true' : undefined}
              >
                {idx + 1}
              </button>
            ))}
          </div>

          {/* Sidebar legend */}
          <div className="sidebar-legend">
            <span className="legend-item"><span className="legend-dot dot--answered" />Answered</span>
            <span className="legend-item"><span className="legend-dot dot--review" />Flagged</span>
            <span className="legend-item"><span className="legend-dot dot--unanswered" />Not answered</span>
          </div>
        </aside>

        {/* Right panel: current question card */}
        <section className="exam-question-panel">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}

          <div className="question-card">
            {/* Question number and flag button */}
            <div className="question-meta">
              <span className="question-number">Question {currentIndex + 1} of {totalQuestions}</span>
              <button
                type="button"
                className={`review-btn ${review.includes(currentQuestion.id) ? 'review-btn--active' : ''}`}
                onClick={handleToggleReview}
                title={review.includes(currentQuestion.id) ? 'Remove flag' : 'Flag for review'}
              >
                {review.includes(currentQuestion.id) ? '🚩 Flagged' : '⚑ Flag for review'}
              </button>
            </div>

            {/* Question text */}
            <p className="question-text">{currentQuestion.text}</p>

            {/* Options */}
            <div className="options-list" role="radiogroup" aria-label={`Options for question ${currentIndex + 1}`}>
              {currentQuestion.options.map((optionText, optIdx) => {
                const isSelected = answers[currentQuestion.id] === optIdx;
                return (
                  <label
                    key={optIdx}
                    className={`option-label ${isSelected ? 'option-label--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`question-${currentQuestion.id}`}
                      className="option-radio"
                      checked={isSelected}
                      onChange={() => handleSelectOption(optIdx)}
                    />
                    <span className="option-marker">{String.fromCharCode(65 + optIdx)}</span>
                    <span className="option-text">{optionText}</span>
                  </label>
                );
              })}
            </div>

            {/* Navigation row */}
            <div className="question-nav">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                disabled={currentIndex === 0}
              >
                ← Previous
              </button>

              <span className="question-nav-spacer" />

              {currentIndex < totalQuestions - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCurrentIndex((i) => Math.min(totalQuestions - 1, i + 1))}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setShowConfirm(true)}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit Exam'}
                </button>
              )}
            </div>

            {/* Unanswered warning below nav when showing submit on last question */}
            {currentIndex === totalQuestions - 1 && unansweredCount > 0 && (
              <p className="unanswered-note">
                ⚠ {unansweredCount} question{unansweredCount > 1 ? 's' : ''} unanswered. You can still go back.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* ── Confirmation modal overlay ── */}
      {showConfirm && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal-card">
            <h2 id="confirm-title" className="modal-title">Submit Exam?</h2>
            <p className="modal-body">
              You have answered {answeredCount} of {totalQuestions} questions.
              {unansweredCount > 0 && ` ${unansweredCount} question${unansweredCount > 1 ? 's are' : ' is'} unanswered.`}
              {' '}This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowConfirm(false)}
              >
                Go back
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : 'Confirm Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
