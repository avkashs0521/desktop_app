// src/screens/SetupScreen.jsx - Pre-exam verification, system readiness check, and camera preview
import { useState } from 'react';

/**
 * Setup and environmental readiness screen.
 * Displays candidate verification and webcam checks before allowing the exam to launch.
 */
export default function SetupScreen({
  candidate,
  examTitle,
  durationMs,
  onStart,
  onBack,
  error,
  cameraStatus,
  cameraError,
  onEnableCamera,
  onOpenSettings,
  checks = {},
}) {
  const [starting, setStarting] = useState(false);
  const durationMinutes = Math.round(durationMs / 60000);
  const isCameraReady = Boolean(checks.camera);

  const handleStart = async () => {
    setStarting(true);
    try {
      await onStart();
    } catch {
      // Handled via error prop
    } finally {
      setStarting(false);
    }
  };

  const getStatusBadge = () => {
    switch (cameraStatus) {
      case 'on':
        return <span className="status-pill pill-success">On</span>;
      case 'waiting':
        return <span className="status-pill pill-warning">Waiting</span>;
      case 'denied':
        return <span className="status-pill pill-danger">Denied</span>;
      default:
        return <span className="status-pill pill-default">Not checked</span>;
    }
  };

  return (
    <div className="screen-container">
      <div className="card setup-card">
        <span className="brand-badge">Pre-Flight Readiness</span>
        <h1 className="screen-title">{examTitle || 'Exam Setup'}</h1>
        <p className="screen-subtitle">Please verify your details and complete the hardware checks before launching.</p>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        {cameraError && (
          <div className="error-banner" role="alert">
            <span>{cameraError}</span>
          </div>
        )}

        {/* Candidate Information Card */}
        <div className="candidate-summary">
          <div className="summary-item">
            <span className="summary-label">Candidate Name</span>
            <span className="summary-value">{candidate?.name || '—'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Roll Number</span>
            <span className="summary-value">{candidate?.rollNo || '—'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Allocated Duration</span>
            <span className="summary-value">{durationMinutes} Minutes</span>
          </div>
        </div>

        {/* System Checks Card */}
        <div className="system-checks-card">
          <h2 className="section-title">System Checks</h2>

          <div className="check-row">
            <div className="check-info">
              <span className="check-title">Webcam Proctoring</span>
              <p className="check-desc">Continuous video verification is required throughout this assessment.</p>
            </div>

            <div className="check-actions">
              {getStatusBadge()}
              {cameraStatus !== 'on' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={onEnableCamera}
                  disabled={cameraStatus === 'waiting'}
                >
                  {cameraStatus === 'waiting' ? 'Accessing...' : 'Enable camera'}
                </button>
              )}
            </div>
          </div>

          {cameraStatus === 'denied' && (
            <div className="denied-guidance">
              <p className="denied-hint">Please allow camera access in macOS System Settings, then relaunch Argus.</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onOpenSettings}
              >
                Open System Settings
              </button>
            </div>
          )}

          {/* 320x240 Camera Preview Frame */}
          <div className="camera-preview-wrapper">
            <div id="setup-camera-placeholder" className="setup-camera-placeholder">
              {cameraStatus !== 'on' && (
                <div className="placeholder-empty-state">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>Camera preview will appear here once enabled</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="btn-group">
          <button type="button" className="btn btn-secondary" onClick={onBack} disabled={starting}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleStart}
            disabled={starting || !isCameraReady}
            title={!isCameraReady ? 'Turn on your camera before starting' : 'Start the assessment'}
          >
            {starting ? 'Initializing Session...' : 'Start Exam'}
          </button>
        </div>
      </div>
    </div>
  );
}
