// src/App.jsx - Main application coordinator routing screens by exam phase
import { useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar';
import { useExamState } from './hooks/useExamState';
import { useCamera } from './hooks/useCamera';
import { isElectron } from './api';
import WelcomeScreen from './screens/WelcomeScreen';
import SetupScreen from './screens/SetupScreen';
import ExamScreen from './screens/ExamScreen';
import ResultScreen from './screens/ResultScreen';

/**
 * Main application coordinator.
 * Reads single-source-of-truth exam state from the main process and renders the matching screen.
 * Maintains one persistent <video> element for webcam streaming across phase transitions.
 */
export default function App() {
  const { state, send, error } = useExamState();
  const {
    videoRef,
    status: cameraStatus,
    error: cameraError,
    start: startCamera,
    stop: stopCamera,
    openSettings,
  } = useCamera({ phase: state?.phase, send });
  const cameraFrameRef = useRef(null);

  // Turn off the camera when the exam concludes (submitted or terminated)
  useEffect(() => {
    if (state?.phase === 'submitted' || state?.phase === 'terminated') {
      stopCamera();
    }
  }, [state?.phase, stopCamera]);

  // Dynamically position the persistent camera overlay to match the 320x240 placeholder in SetupScreen
  useEffect(() => {
    if (state?.phase === 'setup' && cameraStatus === 'on') {
      const updatePosition = () => {
        const placeholder = document.getElementById('setup-camera-placeholder');
        if (placeholder && cameraFrameRef.current) {
          const rect = placeholder.getBoundingClientRect();
          cameraFrameRef.current.style.top = `${rect.top}px`;
          cameraFrameRef.current.style.left = `${rect.left}px`;
          cameraFrameRef.current.style.width = `${rect.width}px`;
          cameraFrameRef.current.style.height = `${rect.height}px`;
        }
      };

      updatePosition();
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [state?.phase, cameraStatus]);

  if (!isElectron) {
    return (
      <>
        <TitleBar />
        <div className="screen-container">
          <div className="card welcome-card">
            <span className="brand-badge">macOS Exam Client</span>
            <h1 className="screen-title">Argus Desktop</h1>
            <p className="screen-subtitle">This examination client requires the secure Electron desktop runtime.</p>
            <div className="status-badge">
              <span className="status-indicator" />
              <span>Running in a browser</span>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!state) {
    return (
      <>
        <TitleBar />
        <div className="screen-container">
          <div className="card welcome-card">
            <h1 className="screen-title">Argus</h1>
            <p className="screen-subtitle">Initializing secure assessment environment...</p>
          </div>
        </div>
      </>
    );
  }

  const setupError = error?.code === 'CANCELLED' ? null : error?.message;

  return (
    <>
      <TitleBar phase={state.phase} />
      <main className="main-content">
        {state.phase === 'welcome' && (
          <WelcomeScreen
            candidate={state.candidate}
            onRegister={(candidate) => send('REGISTER_CANDIDATE', candidate)}
            error={error?.message}
          />
        )}

        {state.phase === 'setup' && (
          <SetupScreen
            candidate={state.candidate}
            examTitle={state.examTitle}
            durationMs={state.durationMs}
            onStart={() => send('START_EXAM').catch(() => {})}
            onBack={() => send('RESET')}
            error={setupError}
            cameraStatus={cameraStatus}
            cameraError={cameraError}
            onEnableCamera={startCamera}
            onOpenSettings={openSettings}
            checks={state.checks}
          />
        )}

        {state.phase === 'in_progress' && (
          <ExamScreen
            examTitle={state.examTitle}
            durationMs={state.durationMs}
            endsAt={state.endsAt}
            candidate={state.candidate}
            answers={state.answers || {}}
            review={state.review || []}
            onSubmit={() => send('SUBMIT_EXAM').catch(() => {})}
            send={send}
            error={setupError}
          />
        )}

        {(state.phase === 'submitted' || state.phase === 'terminated') && (
          <ResultScreen
            state={state}
            onReset={() => send('RESET')}
          />
        )}
      </main>

      {/* Persistent Proctor Camera (kept mounted across setup -> exam to preserve hardware stream) */}
      <div
        ref={cameraFrameRef}
        className={`persistent-camera-frame mode-${state.phase} status-${cameraStatus}`}
        aria-hidden={cameraStatus !== 'on' || state.phase === 'welcome' || state.phase === 'submitted' || state.phase === 'terminated'}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="persistent-video-element"
        />
        {state.phase === 'in_progress' && (
          <div className="proctoring-pill">
            <span className="proctoring-dot" />
            <span>Proctoring on</span>
          </div>
        )}
      </div>
    </>
  );
}
