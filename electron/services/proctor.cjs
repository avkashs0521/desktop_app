// electron/services/proctor.cjs - Integrity proctoring: multi-monitor detection & process scanning
const { screen } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

/**
 * Initializes real-time exam proctoring monitors:
 * 1. Multi-display detection on start and during connection.
 * 2. Background process inspection for unauthorized/prohibited applications.
 *
 * @param {Object} params
 * @param {import('../core/examStore.cjs').ExamStore} params.store - Exam state machine
 * @param {Object} params.config - Exam configuration
 * @param {Object} params.scope - Active exam lifecycle resource scope
 */
function startProctoring({ store, config, scope }) {
  // 1. Display Monitoring
  // Check if multiple monitors are connected at start
  if (screen.getAllDisplays().length > 1) {
    store.dispatch('RECORD_VIOLATION', {
      source: 'main',
      payload: {
        kind: 'multiple_displays',
        detail: `Multiple displays detected (${screen.getAllDisplays().length} active monitors)`,
      },
    }).catch((err) => console.error('[Proctor] Error recording multiple_displays:', err));
  }

  // Listen for secondary monitors plugged in during the exam
  const onDisplayAdded = () => {
    store.dispatch('RECORD_VIOLATION', {
      source: 'main',
      payload: {
        kind: 'display_added',
        detail: 'An external display was connected during the exam',
      },
    }).catch((err) => console.error('[Proctor] Error recording display_added:', err));
  };

  screen.on('display-added', onDisplayAdded);
  scope.track(() => {
    screen.removeListener('display-added', onDisplayAdded);
  });

  // 2. Process Monitoring (skip on Windows)
  if (process.platform !== 'win32') {
    const reportedApps = new Set();
    const blockedApps = Array.isArray(config.blockedApps)
      ? config.blockedApps.map((a) => a.toLowerCase().trim())
      : [];
    const scanIntervalMs = (config.processScanIntervalSeconds || 15) * 1000;

    const scanProcesses = () => {
      /**
       * SECURITY NOTE:
       * We use execFile rather than exec because execFile runs the executable directly
       * without spawning a shell (/bin/sh). This eliminates shell injection vulnerabilities,
       * shell quoting bugs, and argument parsing risks.
       */
      execFile('ps', ['-Ao', 'comm='], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) {
          // Skip on any timeout or execution error
          return;
        }

        const lines = stdout.split('\n');
        for (const line of lines) {
          const rawName = path.basename(line.trim()).toLowerCase();
          if (!rawName) continue;

          for (const blocked of blockedApps) {
            if (rawName.startsWith(blocked)) {
              if (!reportedApps.has(blocked)) {
                reportedApps.add(blocked);
                store.dispatch('RECORD_VIOLATION', {
                  source: 'main',
                  payload: {
                    kind: 'blocked_app',
                    detail: `Prohibited background application detected: ${blocked}`,
                  },
                }).catch((e) => console.error('[Proctor] Error recording blocked_app:', e));
              }
              break;
            }
          }
        }
      });
    };

    // Schedule process scan interval tracked by the exam scope
    scope.interval(scanProcesses, scanIntervalMs);
  }
}

module.exports = {
  startProctoring,
};
