// src/screens/ExamScreen.jsx - Real MCQ exam assessment screen with palette, timer, and keyboard nav
import { useState, useEffect } from 'react';
import { api } from '../api';
import { useRemainingTime } from '../hooks/useRemainingTime';
import { formatDuration } from '../utils/formatTime';
import WarningBanner from '../components/WarningBanner';

/**
 * Active examination screen.
 *
 * Architecture rules:
 * - Questions are loaded once from the main process via api.exam.getQuestions() on mount (and on reload).
 * - currentIndex is the ONLY exam-related state owned by React.
 * - answers and review flags are strictly read from the main process state (single source of truth).
 * - question.id is used as the React key, never the array index.
 * - Left/Right arrow keys navigate between questions.
 *
 * @param {Object} props
 * @param {string} props.examTitle
 * @param {number} props.durationMs
 * @param {Object} props.candidate
 * @param {Object} props.answers   - Single-source map of { [questionId]: optionIndex }
 * @param {Array}  props.review    - Single-source array of flagged question IDs
 * @param {Function} props.onSubmit
 * @param {Function} props.send    - ExamStore command dispatcher
 * @param {string|null} props.error
 */
export default function ExamScreen({
  examTitle,
  durationMs,
  candidate,
  answers = {},
  review = [],
  onSubmit,
  send,
  error,
}) {
  const remainingMs = useRemainingTime(durationMs);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Load questions once when phase becomes in_progress (and again after window reload)
  useEffect(() => {
    let mounted = true;

    api.exam
      .getQuestions()
      .then((data) => {
        if (mounted && Array.isArray(data)) {
          setQuestions(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load exam questions from main process:', err);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex];

  // Arrow key navigation between questions
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'ArrowLeft') {
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex((i) => Math.min(totalQuestions - 1, i + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [totalQuestions]);

  // Derived progress statistics
  const answeredCount = Object.keys(answers).length;
  const reviewCount = review.length;
  const unansweredCount = totalQuestions - answeredCount;

  // Countdown timer turns red under 5 minutes (300,000 ms)
  const isLowTime = remainingMs > 0 && remainingMs < 5 * 60 * 1000;
  const isCriticalTime = remainingMs > 0 && remainingMs < 60 * 1000;

  /** Save answer selection to main process */
  const handleSelectOption = (optionIndex) => {
    if (!currentQuestion) return;
    send('SAVE_ANSWER', { questionId: currentQuestion.id, optionIndex }).catch(() => {});
  };

  /** Clear answer response (SAVE_ANSWER with optionIndex null) */
  const handleClearResponse = () => {
    if (!currentQuestion) return;
    send('SAVE_ANSWER', { questionId: currentQuestion.id, optionIndex: null }).catch(() => {});
  };

  /** Toggle review flag */
  const handleToggleReview = () => {
    if (!currentQuestion) return;
    send('TOGGLE_REVIEW', { questionId: currentQuestion.id }).catch(() => {});
  };

  /** Confirmed submission */
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit();
    } catch {
      // Cancellation handled gracefully without error banner
    } finally {
      setSubmitting(false);
    }
  };

  /** Builds CSS class for question palette buttons */
  const getPillClass = (q, idx) => {
    const isCurrent = idx === currentIndex;
    const isAnswered = answers[q.id] !== undefined;
    const isReview = review.includes(q.id);

    let cls = 'q-pill';
    if (isAnswered) cls += ' q-pill--answered';
    if (isReview) cls += ' q-pill--review';
    if (!isAnswered && !isReview) cls += ' q-pill--unanswered';
    if (isCurrent) cls += ' q-pill--current';

    return cls;
  };

  if (loading) {
    return (
      <div className="screen-container">
        <div className="card exam-card">
          <p className="screen-subtitle">Loading assessment questions…</p>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="screen-container">
        <div className="card exam-card">
          <p className="screen-subtitle">No questions available in the current question bank.</p>
        </div>
      </div>
    );
  }

  const marks = typeof currentQuestion.marks === 'number' ? currentQuestion.marks : 1;

  return (
    <div
      className="screen-container exam-screen-layout"
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onPaste={(e) => e.preventDefault()}
    >
      {/* Warning banner rendered at top of exam screen */}
      <WarningBanner />

      {/* ── Top Header Bar ── */}
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

          {/* Countdown timer (turns red under 5 minutes) */}
          <div
            className={`timer-box ${isLowTime ? 'timer-box--warning' : ''} ${isCriticalTime ? 'timer-box--critical' : ''}`}
            aria-label="Remaining Exam Time"
          >
            <span className="timer-label">Time</span>
            <span className="timer-countdown">{formatDuration(remainingMs)}</span>
          </div>

          {/* Submit button in header */}
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : 'Submit Exam'}
          </button>
        </div>
      </header>

      {/* ── Main Two-Column Layout: Question Palette + Question Panel ── */}
      <div className="exam-body">
        {/* Left sidebar: Question Palette */}
        <aside className="exam-sidebar">
          <p className="sidebar-heading">Questions</p>
          <div className="q-grid">
            {questions.map((q, idx) => (
              <button
                key={q.id}
                type="button"
                className={getPillClass(q, idx)}
                onClick={() => setCurrentIndex(idx)}
                title={`Question ${idx + 1}${review.includes(q.id) ? ' (Flagged)' : ''}${answers[q.id] !== undefined ? ' (Answered)' : ''}`}
                aria-current={idx === currentIndex ? 'true' : undefined}
              >
                {idx + 1}
              </button>
            ))}
          </div>

          {/* Palette legend */}
          <div className="sidebar-legend">
            <span className="legend-item"><span className="legend-dot dot--answered" />Answered</span>
            <span className="legend-item"><span className="legend-dot dot--review" />Marked for review</span>
            <span className="legend-item"><span className="legend-dot dot--unanswered" />Not answered</span>
          </div>
        </aside>

        {/* Right panel: Active Question Card */}
        <section className="exam-question-panel">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
            </div>
          )}

          <div className="question-card" key={currentQuestion.id}>
            {/* Question header: meta and question actions */}
            <div className="question-meta">
              <span className="question-number">
                Question {currentIndex + 1} of {totalQuestions} · {marks} mark{marks > 1 ? 's' : ''}
              </span>

              <div className="question-item-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleClearResponse}
                  disabled={answers[currentQuestion.id] === undefined}
                  title="Clear selected option for this question"
                >
                  Clear response
                </button>

                <button
                  type="button"
                  className={`review-btn ${review.includes(currentQuestion.id) ? 'review-btn--active' : ''}`}
                  onClick={handleToggleReview}
                  title={review.includes(currentQuestion.id) ? 'Remove review flag' : 'Mark question for review'}
                >
                  {review.includes(currentQuestion.id) ? '🚩 Flagged' : '⚑ Mark for review'}
                </button>
              </div>
            </div>

            {/* Question text */}
            <p className="question-text">{currentQuestion.text}</p>

            {/* Options list as large radio cards */}
            <div className="options-list" role="radiogroup" aria-label={`Options for question ${currentIndex + 1}`}>
              {currentQuestion.options.map((optionText, optIdx) => {
                const isSelected = answers[currentQuestion.id] === optIdx;
                return (
                  <label
                    key={`${currentQuestion.id}-opt-${optIdx}`}
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
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit Exam'}
                </button>
              )}
            </div>

            {/* Unanswered count notice below nav */}
            {currentIndex === totalQuestions - 1 && unansweredCount > 0 && (
              <p className="unanswered-note">
                ⚠ {unansweredCount} question{unansweredCount > 1 ? 's' : ''} unanswered. You can still navigate back.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
