// electron/core/examStore.cjs - Central state machine and command dispatcher for Argus exams

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { config } = require('./config.cjs');
const { createScope } = require('./lifecycle.cjs');
const examTimer = require('../services/examTimer.cjs');

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
]);

/**
 * State machine transition rules.
 * Defines which commands are permitted in each phase.
 */
const TRANSITIONS = Object.freeze({
  [PHASES.WELCOME]: ['REGISTER_CANDIDATE'],
  [PHASES.SETUP]: ['START_EXAM', 'RESET', 'REPORT_CHECK'],
  [PHASES.IN_PROGRESS]: ['SAVE_ANSWER', 'TOGGLE_REVIEW', 'SUBMIT_EXAM', 'TIME_UP', 'TERMINATE', 'REPORT_CHECK'],
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
      answers: {},
      review: [],
      violations: [],
      snapshotCount: 0,
      checks: { camera: false },
      result: null, // Placeholder until commit 9 ({ answeredCount })
    };
  }

  /**
   * Returns a clean, decoupled copy of the state safe to send over IPC to the renderer.
   * @returns {Object}
   */
  getPublicState() {
    return JSON.parse(JSON.stringify(this.state));
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
        break;
      }

      case 'START_EXAM': {
        if (!this.state.checks?.camera) {
          throw new ExamError('PRECONDITION', 'Turn on your camera before starting');
        }

        const now = Date.now();
        this.state.startedAt = now;
        this.state.endsAt = now + this.state.durationMs;
        this.state.phase = PHASES.IN_PROGRESS;

        // Create dedicated lifecycle scope for this active exam session
        if (this.examScope) {
          this.examScope.dispose();
        }
        this.examScope = createScope('examSession');

        // Start countdown timer
        examTimer.start(this.state.endsAt, this.examScope, () => {
          this.dispatch('TIME_UP', { source: 'main' }).catch((err) => {
            console.error('[ExamStore] Error executing TIME_UP:', err);
          });
        });
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
        this.state.submittedAt = Date.now();
        this.state.submitReason = 'manual';
        this.state.phase = PHASES.SUBMITTED;
        this.state.result = {
          answeredCount: Object.keys(this.state.answers).length,
        };
        break;
      }

      case 'TIME_UP': {
        this.state.submittedAt = Date.now();
        this.state.submitReason = 'time_up';
        this.state.phase = PHASES.SUBMITTED;
        this.state.result = {
          answeredCount: Object.keys(this.state.answers).length,
        };
        break;
      }

      case 'TERMINATE': {
        this.state.submittedAt = Date.now();
        this.state.submitReason = payload?.reason || 'terminated';
        this.state.phase = PHASES.TERMINATED;
        this.state.result = {
          answeredCount: Object.keys(this.state.answers).length,
        };
        break;
      }

      case 'RESET': {
        const preservedCandidate = this.state.candidate;
        this.state = this._createInitialState(preservedCandidate);
        break;
      }

      case 'REPORT_CHECK': {
        this.state.checks[payload.name] = Boolean(payload.ok);
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
      const { optionIndex } = payload;
      const isValidOption = (typeof optionIndex === 'number' && Number.isInteger(optionIndex) && optionIndex >= 0) || optionIndex === null;
      if (!isValidOption) {
        throw new ExamError('VALIDATION', 'SAVE_ANSWER requires optionIndex to be an integer >= 0 or null.');
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
}

// Singleton examStore instance
const examStore = new ExamStore();

module.exports = {
  examStore,
  ExamStore,
  ExamError,
  PHASES,
  RENDERER_COMMANDS,
  INTERNAL_COMMANDS,
  TRANSITIONS,
};
