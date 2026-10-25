// src/components/ErrorBoundary.jsx
// React class component that catches unhandled JS errors in any child component
// tree and displays a fallback UI instead of crashing the whole renderer.
// Class components are required here because React only supports error boundaries
// via getDerivedStateFromError / componentDidCatch lifecycle methods.

import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // hasError: true once a child throws; error/info: kept for display
    this.state = { hasError: false, error: null, info: null };
  }

  // Called during rendering when a descendant throws.
  // Returns state update to switch into error-display mode.
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  // Called after render with the full error + component stack.
  // Log both so the developer can see them in DevTools / terminal.
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught renderer error:', error, info);
    this.setState({ info });
  }

  handleReload() {
    // Reload the renderer window — Electron will re-load the BrowserWindow URL
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) {
      // Normal path: just render children unchanged
      return this.props.children;
    }

    // Fallback UI shown when an error was caught
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Something went wrong</h1>
          <p style={styles.subtitle}>
            An unexpected error occurred in the Argus interface.
          </p>

          {/* Show the error message to help with diagnosis */}
          <pre style={styles.code}>
            {this.state.error?.message || 'Unknown error'}
          </pre>

          <button style={styles.button} onClick={this.handleReload}>
            Reload Argus
          </button>
        </div>
      </div>
    );
  }
}

// Inline styles so the fallback works even if the CSS file failed to load
const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0f0f0f',
    fontFamily: 'system-ui, sans-serif',
    padding: '2rem',
    boxSizing: 'border-box',
  },
  card: {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: '12px',
    padding: '2.5rem',
    maxWidth: '540px',
    width: '100%',
    textAlign: 'center',
  },
  title: {
    color: '#ef4444',
    fontSize: '1.5rem',
    margin: '0 0 0.75rem',
  },
  subtitle: {
    color: '#aaa',
    fontSize: '0.95rem',
    margin: '0 0 1.5rem',
  },
  code: {
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    color: '#f87171',
    fontSize: '0.8rem',
    padding: '0.75rem 1rem',
    textAlign: 'left',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    marginBottom: '1.5rem',
  },
  button: {
    background: '#4f46e5',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.95rem',
    padding: '0.65rem 1.5rem',
  },
};

export default ErrorBoundary;
