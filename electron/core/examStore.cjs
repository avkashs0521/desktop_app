// electron/core/examStore.cjs - Central state machine and command dispatcher for Argus exams

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { config } = require('./config.cjs');
const { createScope } = require('./lifecycle.cjs');
const examTimer = require('../services/examTimer.cjs');
const lockdown = require('../services/lockdown.cjs');
const { getActiveBank, setActiveBankData } = require('../services/questionBank.cjs');
const { app, shell } = require('electron');
const { notify } = require('../services/notifier.cjs');
const { startProctoring } = require('../services/proctor.cjs');
const storage = require('../services/storage.cjs');

// Window getter hook: allows examStore dialogs to attach to the main BrowserWindow
let _getMainWindow = null;

function setWindowGetter(fn) {
  _getMainWindow = fn;
}

function getWindow() {
  return typeof _getMainWindow === 'function' ? _getMainWindow() : null;
}

/**
 * Fisher-Yates shuffle — returns a NEW shuffled array without mutating the original.
 * @param {Array} array
 * @returns {Array}
 */
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Valid exam phases.
 */
const PHASES = Object.freeze({
  WELCOME: 'welcome',
  SETUP: 'setup',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  TERMINATED: 'terminated',
});

/**
 * Commands allowed to be triggered by the renderer.
 */
const RENDERER_COMMANDS = Object.freeze([
  'REGISTER_CANDIDATE',
  'START_EXAM',
  'SAVE_ANSWER',
  'TOGGLE_REVIEW',
  'SUBMIT_EXAM',
  'RESET',
  'REPORT_CHECK',
]);

/**
 * Commands reserved strictly for main-process internal triggers.
 */
const INTERNAL_COMMANDS = Object.freeze([
  'TIME_UP',
  'TERMINATE',
  'RECORD_VIOLATION',
  'SNAPSHOT_SAVED',
]);

/**
 * State machine transition rules.
 * Defines which commands are permitted in each phase.
 */
const TRANSITIONS = Object.freeze({
  [PHASES.WELCOME]: ['REGISTER_CANDIDATE'],
  [PHASES.SETUP]: ['START_EXAM', 'RESET', 'REPORT_CHECK'],
  [PHASES.IN_PROGRESS]: [
    'SAVE_ANSWER',
    'TOGGLE_REVIEW',
    'SUBMIT_EXAM',
    'TIME_UP',
    'TERMINATE',
    'REPORT_CHECK',
    'RECORD_VIOLATION',
    'SNAPSHOT_SAVED',
  ],
  [PHASES.SUBMITTED]: ['RESET'],
  [PHASES.TERMINATED]: ['RESET'],
});

/**
 * Custom error class with structured error codes.
 */
class ExamError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamError';
    this.code = code;
  }
}

class ExamStore extends EventEmitter {
  constructor() {
    super();

    this.state = this._createInitialState();
    this.examScope = null;

    // Command queue promise chain to serialize command execution
    this._queue = Promise.resolve();
  }

  /**
   * Initializes or resets state while retaining candidate details if available.
   * @private
   */
  _createInitialState(existingCandidate = { name: '', rollNo: '' }) {
    return {
      sessionId: crypto.randomUUID(),
      phase: PHASES.WELCOME,
      candidate: { ...existingCandidate },
      examTitle: config.title,
      durationMs: config.durationMinutes * 60 * 1000,
      startedAt: null,
      endsAt: null,
      submittedAt: null,
      submitReason: null,
      bank: null,
      questionOrder: [],
      answers: {},
      review: [],
      violations: [],
      snapshotCount: 0,
      checks: { camera: false },
      result: null,
    };
  }

  /**
   * Returns a clean, decoupled copy of the state safe to send over IPC to the renderer.
   * @returns {Object}
   */
  getPublicState() {
    const pub = JSON.parse(JSON.stringify(this.state));
    pub.proctor = {
      maxViolations: config.maxViolations,
      snapshotIntervalSeconds: config.snapshotIntervalSeconds,
    };
    return pub;
  }

  /**
   * Dispatches a command through the serialized execution queue.
   *
   * DESIGN NOTE:
   * Commands are queued via a promise chain so that each command executes strictly one at a time.
   * This completely prevents race conditions and state corruption from rapid or concurrent
   * events (e.g. simultaneous user clicks and timer expiration, or async confirmation dialogs).
   *
   * @param {string} command - Command name
   * @param {Object} [options]
   * @param {string} [options.source='renderer'] - 'renderer' or 'main'
   * @param {any} [options.payload] - Command payload
   * @returns {Promise<Object>} The updated public state
   */
  dispatch(command, options = {}) {
    const { source = 'renderer', payload = {} } = options;

    const execute = async () => {
      return this._handleCommand(command, source, payload);
    };

    // Chain onto the queue; catch errors so future commands can still execute
    const taskPromise = this._queue.then(execute, execute);
    this._queue = taskPromise.catch(() => {});
    return taskPromise;
  }

  /**
   * Core handler that validates and executes a command against the state machine.
   * @private
   */
  async _handleCommand(command, source, payload) {
    // 1. Enforce access control for internal-only commands
    if (INTERNAL_COMMANDS.includes(command) && source !== 'main') {
      throw new ExamError('NOT_ALLOWED', `Command '${command}' is an internal main-process command and cannot be called from the renderer.`);
    }

    // 2. Validate phase transitions
    const allowed = TRANSITIONS[this.state.phase] || [];
    if (!allowed.includes(command)) {
      throw new ExamError('INVALID_PHASE', `${command} is not allowed during '${this.state.phase}'`);
    }

    // 3. Validate command payload
    this._validatePayload(command, payload);

    const prevPhase = this.state.phase;

    // 4. Execute state mutation
    switch (command) {
      case 'REGISTER_CANDIDATE': {
        this.state.candidate = {
          name: payload.name.trim(),
          rollNo: payload.rollNo.trim(),
        };
        this.state.phase = PHASES.SETUP;
        // Persist candidate in settings so welcome form is prefilled on next launch
        storage.updateSettings({ candidate: this.state.candidate }).catch((err) => {
          console.warn('[ExamStore] Failed to prefill candidate into settings:', err);
        });
        break;
      }

      case 'START_EXAM': {
        if (!this.state.checks?.camera) {
          throw new ExamError('PRECONDITION', 'Turn on your camera before starting');
        }

        const win = getWindow();
        if (win) {
          const accepted = await lockdown.showRulesDialog(win);
          if (!accepted) {
            throw new ExamError('CANCELLED', 'Exam start cancelled by candidate.');
          }
        }

        // Build question order from the active question bank
        const activeBank = getActiveBank();
        const bank = activeBank.bank;
        const rawIds = bank.questions.map((q) => q.id);
        const questionOrder = config.shuffleQuestions ? shuffleArray(rawIds) : [...rawIds];
        const totalMarks = bank.questions.reduce((sum, q) => sum + (typeof q.marks === 'number' ? q.marks : 1), 0);

        const now = Date.now();
        this.state.startedAt = now;
        this.state.endsAt = now + this.state.durationMs;
        this.state.phase = PHASES.IN_PROGRESS;
        this.state.questionOrder = questionOrder;
        this.state.bank = {
          bankId: bank.bankId,
          title: bank.title,
          hash: activeBank.hash,
          count: bank.questions.length,
          totalMarks,
        };

        // Create dedicated lifecycle scope for this active exam session
        if (this.examScope) {
          this.examScope.dispose();
        }
        this.examScope = createScope('examSession');

        // Enter exam lockdown (kiosk, always-on-top, content protection, power-save blocker)
        if (win) {
          lockdown.enter(win, this.examScope);
        }

        // Start countdown timer
        examTimer.start(this.state.endsAt, this.examScope, () => {
          this.dispatch('TIME_UP', { source: 'main' }).catch((err) => {
            console.error('[ExamStore] Error executing TIME_UP:', err);
          });
        });

        // Initialize display and process monitoring proctors
        startProctoring({ store: this, config, scope: this.examScope });
        break;
      }

      case 'SAVE_ANSWER': {
        const { questionId, optionIndex } = payload;
        if (optionIndex === null) {
          delete this.state.answers[questionId];
        } else {
          this.state.answers[questionId] = optionIndex;
        }
        break;
      }

      case 'TOGGLE_REVIEW': {
        const { questionId } = payload;
        if (this.state.review.includes(questionId)) {
          this.state.review = this.state.review.filter((id) => id !== questionId);
        } else {
          this.state.review.push(questionId);
        }
        break;
      }

      case 'SUBMIT_EXAM': {
        if (source === 'renderer') {
          const win = getWindow();
          if (win) {
            const answeredCount = Object.keys(this.state.answers || {}).length;
            const totalCount = this.state.questionOrder?.length || 0;
            const reviewCount = this.state.review?.length || 0;
            const confirmed = await lockdown.showSubmitConfirm(win, {
              answeredCount,
              totalCount,
              reviewCount,
            });
            if (!confirmed) {
              throw new ExamError('CANCELLED', 'Submission cancelled by candidate.');
            }
          }
          // The renderer cannot set a reason — always 'manual'
          this.state.submitReason = 'manual';
        } else {
          // Main-process triggered (e.g. quit guard)
          this.state.submitReason = payload?.reason || 'quit';
        }

        this.state.submittedAt = Date.now();
        this.state.phase = PHASES.SUBMITTED;
        this.state.result = this._calculateResult();
        break;
      }

      case 'TIME_UP': {
        this.state.submittedAt = Date.now();
        this.state.submitReason = 'time_up';
        this.state.phase = PHASES.SUBMITTED;
        this.state.result = this._calculateResult();
        break;
      }

      case 'TERMINATE': {
        this.state.submittedAt = Date.now();
        this.state.submitReason = payload?.reason || 'terminated';
        this.state.phase = PHASES.TERMINATED;
        this.state.result = this._calculateResult();
        break;
      }

      case 'RESET': {
        if (app.dock && typeof app.dock.setBadge === 'function') {
          app.dock.setBadge('');
        }
        const preservedCandidate = this.state.candidate;
        this.state = this._createInitialState(preservedCandidate);
        break;
      }

      case 'REPORT_CHECK': {
        this.state.checks[payload.name] = Boolean(payload.ok);
        if (payload.name === 'camera' && !payload.ok && this.state.phase === PHASES.IN_PROGRESS) {
          this.addViolation('camera_off', 'Camera stopped');
        }
        break;
      }

      case 'RECORD_VIOLATION': {
        const { kind, detail } = payload || {};
        this.addViolation(kind || 'generic', detail || 'Violation recorded');
        break;
      }

      case 'SNAPSHOT_SAVED': {
        this.state.snapshotCount = (this.state.snapshotCount || 0) + 1;
        break;
      }

      default:
        throw new ExamError('UNKNOWN_COMMAND', `Unknown command: ${command}`);
    }

    // 5. Cleanup session scope when leaving in_progress phase
    if (prevPhase === PHASES.IN_PROGRESS && this.state.phase !== PHASES.IN_PROGRESS) {
      if (this.examScope) {
        this.examScope.dispose();
        this.examScope = null;
      }
    }

    // 6. Emit events for observers and IPC subscribers
    const publicState = this.getPublicState();
    if (prevPhase !== this.state.phase) {
      this.emit('phase', this.state.phase);
    }
    this.emit('change', publicState);

    return publicState;
  }

  /**
   * Validates command payload data types and business constraints.
   * @private
   */
  _validatePayload(command, payload) {
    if (command === 'REGISTER_CANDIDATE') {
      const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
      const rollNo = typeof payload?.rollNo === 'string' ? payload.rollNo.trim() : '';

      if (name.length < 2 || name.length > 60) {
        throw new ExamError('VALIDATION', 'Candidate name must be between 2 and 60 characters.');
      }

      const rollRegex = /^[a-zA-Z0-9]{3,30}$/;
      if (!rollRegex.test(rollNo)) {
        throw new ExamError('VALIDATION', 'Roll number must be between 3 and 30 alphanumeric characters.');
      }
    }

    if (command === 'SAVE_ANSWER') {
      if (!payload || typeof payload.questionId !== 'string' || payload.questionId.trim() === '') {
        throw new ExamError('VALIDATION', 'SAVE_ANSWER requires a non-empty questionId string.');
      }
      const questionId = payload.questionId.trim();
      if (!this.state.questionOrder || !this.state.questionOrder.includes(questionId)) {
        throw new ExamError('VALIDATION', `Question '${questionId}' does not exist in the active session.`);
      }

      const activeBank = getActiveBank();
      const question = activeBank.bank?.questions?.find((q) => q.id === questionId);
      if (!question) {
        throw new ExamError('VALIDATION', `Question '${questionId}' was not found in the question bank.`);
      }

      const { optionIndex } = payload;
      if (optionIndex !== null) {
        const isValidOption = typeof optionIndex === 'number' && Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < question.options.length;
        if (!isValidOption) {
          throw new ExamError('VALIDATION', `optionIndex ${optionIndex} is outside valid options range (0–${question.options.length - 1}).`);
        }
      }
    }

    if (command === 'TOGGLE_REVIEW') {
      if (!payload || typeof payload.questionId !== 'string' || payload.questionId.trim() === '') {
        throw new ExamError('VALIDATION', 'TOGGLE_REVIEW requires a non-empty questionId string.');
      }
    }

    if (command === 'REPORT_CHECK') {
      if (!payload || payload.name !== 'camera' || typeof payload.ok !== 'boolean') {
        throw new ExamError('VALIDATION', "REPORT_CHECK requires { name: 'camera', ok: boolean }");
      }
    }
  }

  /**
   * Grades the current answers against the correct answer keys in the active question bank.
   * @private
   * @returns {{ answeredCount: number, correctCount: number, totalCount: number, scorePercent: number, totalMarks: number, earnedMarks: number }}
   */
  _calculateResult() {
    const activeBank = getActiveBank();
    const questions = activeBank.bank?.questions || [];
    const answers = this.state.answers || {};
    const answeredCount = Object.keys(answers).length;

    let correctCount = 0;
    let earnedMarks = 0;
    let totalMarks = 0;

    questions.forEach((q) => {
      const marks = typeof q.marks === 'number' ? q.marks : 1;
      totalMarks += marks;
      if (answers[q.id] === q.answerIndex) {
        correctCount += 1;
        earnedMarks += marks;
      }
    });

    const totalCount = questions.length;
    const scorePercent = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;

    return {
      answeredCount,
      correctCount,
      totalCount,
      scorePercent,
      totalMarks,
      earnedMarks,
    };
  }

  /**
   * Restores an in-progress session after app relaunch or crash.
   * Validates the saved object's shape before accepting it.
   *
   * Comment: The clock keeps running while the app is closed (endsAt is wall-clock),
   * so quitting cannot pause an exam.
   *
   * @param {Object} saved - Persisted session state
   * @param {Object} [bankData] - Validated question bank matching session bank.hash
   * @returns {Object} Restored public state
   */
  restore(saved, bankData) {
    if (
      !saved ||
      typeof saved !== 'object' ||
      typeof saved.sessionId !== 'string' ||
      typeof saved.startedAt !== 'number' ||
      typeof saved.endsAt !== 'number' ||
      !saved.bank ||
      typeof saved.bank.hash !== 'string' ||
      !Array.isArray(saved.questionOrder) ||
      typeof saved.answers !== 'object'
    ) {
      throw new ExamError('CORRUPT_SESSION', 'Saved session state has an invalid shape.');
    }

    if (bankData) {
      setActiveBankData(bankData);
    }

    // Set state back into in_progress, but force camera re-check
    this.state = {
      ...saved,
      phase: PHASES.IN_PROGRESS,
      checks: {
        ...(saved.checks || {}),
        camera: false, // Force re-activation in renderer
      },
      review: Array.isArray(saved.review) ? [...saved.review] : [],
      violations: Array.isArray(saved.violations) ? [...saved.violations] : [],
      snapshotCount: saved.snapshotCount || 0,
      result: null,
      submittedAt: null,
      submitReason: null,
    };

    // Recreate lifecycle scope for resumed session
    if (this.examScope) {
      this.examScope.dispose();
    }
    this.examScope = createScope('examSession');

    // Re-enter lockdown
    const win = getWindow();
    if (win) {
      lockdown.enter(win, this.examScope);
    }

    // Restart timer with the saved endsAt
    examTimer.start(this.state.endsAt, this.examScope, () => {
      this.dispatch('TIME_UP', { source: 'main' }).catch((err) => {
        console.error('[ExamStore] Error executing TIME_UP on resumed exam:', err);
      });
    });

    // Re-initialize proctoring monitors
    startProctoring({ store: this, config, scope: this.examScope });

    this.emit('phase', this.state.phase);
    this.emit('change', this.getPublicState());
    return this.getPublicState();
  }

  /**
   * Submits a recovered session without continuing the exam.
   * Used when candidate chooses "Submit it now" on crash recovery, or when
   * time expired while the app was closed (reason: 'time_up_while_closed').
   *
   * @param {Object} saved - Persisted session state
   * @param {string} reason - Submit reason ('submitted_on_resume' | 'time_up_while_closed')
   * @param {Object} [bankData]
   * @returns {Object} Public state
   */
  restoreAndSubmit(saved, reason, bankData) {
    if (bankData) {
      setActiveBankData(bankData);
    }

    this.state = {
      ...saved,
      phase: PHASES.SUBMITTED,
      submittedAt: Date.now(),
      submitReason: reason,
    };

    this.state.result = this._calculateResult();
    storage.saveSessionSync(this.state);

    this.emit('phase', this.state.phase);
    this.emit('change', this.getPublicState());
    return this.getPublicState();
  }

  /**
   * Marks a session terminated when its question bank is missing or unrecoverable.
   * @param {Object} saved - Persisted session state
   * @param {string} reason - Termination reason ('bank_missing')
   * @returns {Object} Public state
   */
  terminateSession(saved, reason) {
    this.state = {
      ...saved,
      phase: PHASES.TERMINATED,
      submittedAt: Date.now(),
      submitReason: reason,
      result: null,
    };

    storage.saveSessionSync(this.state);

    this.emit('phase', this.state.phase);
    this.emit('change', this.getPublicState());
    return this.getPublicState();
  }

  /**
   * Records a security violation, triggers OS/Dock alerts, and auto-terminates if limit is reached.
   *
   * @param {string} kind - Violation category ('multiple_displays' | 'blocked_app' | 'camera_off')
   * @param {string} detail - Context description
   */
  addViolation(kind, detail) {
    const at = Date.now();
    this.state.violations.push({ at, kind, detail });

    const count = this.state.violations.length;
    const max = config.maxViolations;

    notify(`Violation ${count} of ${max}`, detail);
    shell.beep();
    if (app.dock && typeof app.dock.setBadge === 'function') {
      app.dock.setBadge(String(count));
    }

    this.emit('violation', { kind, detail, count, max });

    // When violations.length reaches config.maxViolations, call dispatch('TERMINATE', { reason: 'max_violations' }) WITHOUT awaiting it.
    // Comment: awaiting a queued command from inside another command would deadlock the queue.
    if (count >= max) {
      this.dispatch('TERMINATE', {
        source: 'main',
        payload: { reason: 'max_violations' },
      }).catch((err) => {
        console.error('[ExamStore] Error terminating for max_violations:', err);
      });
    }
  }
}

// Singleton examStore instance
const examStore = new ExamStore();

module.exports = {
  examStore,
  ExamStore,
  ExamError,
  setWindowGetter,
  PHASES,
  RENDERER_COMMANDS,
  INTERNAL_COMMANDS,
  TRANSITIONS,
};
