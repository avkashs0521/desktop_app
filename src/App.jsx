// src/App.jsx - Main application coordinator routing screens by exam phase
import TitleBar from './components/TitleBar';
import { useExamState } from './hooks/useExamState';
import { isElectron } from './api';
import WelcomeScreen from './screens/WelcomeScreen';
import SetupScreen from './screens/SetupScreen';
import ExamScreen from './screens/ExamScreen';
import ResultScreen from './screens/ResultScreen';

/**
 * Main application coordinator.
 * Reads single-source-of-truth exam state from the main process and renders the matching screen.
 * Strictly no exam state is retained in React.
 */
export default function App() {
  const { state, send, error } = useExamState();

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

  return (
    <>
      <TitleBar />
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
            onStart={() => send('START_EXAM')}
            onBack={() => send('RESET')}
            error={error?.message}
          />
        )}

        {state.phase === 'in_progress' && (
          <ExamScreen
            examTitle={state.examTitle}
            durationMs={state.durationMs}
            endsAt={state.endsAt}
            candidate={state.candidate}
            onSubmit={() => send('SUBMIT_EXAM')}
            error={error?.message}
          />
        )}

        {(state.phase === 'submitted' || state.phase === 'terminated') && (
          <ResultScreen
            state={state}
            onReset={() => send('RESET')}
          />
        )}
      </main>
    </>
  );
}
