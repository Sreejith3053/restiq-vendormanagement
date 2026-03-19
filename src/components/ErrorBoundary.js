import React from 'react';

/**
 * ErrorBoundary.js
 *
 * Global React error boundary to prevent full app crashes.
 * Catches render errors in child components and shows a recovery UI.
 *
 * Usage in App.js:
 *   import ErrorBoundary from './components/ErrorBoundary';
 *   <ErrorBoundary><App /></ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo });
        // Log to console (and optionally to Firestore or external service)
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    handleReload = () => {
        window.location.reload();
    };

    handleGoHome = () => {
        window.location.href = '/';
    };

    handleDismiss = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    minHeight: '100vh',
                    background: '#0b0f1a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: "'Inter', -apple-system, sans-serif",
                    color: '#e2e8f0',
                }}>
                    <div style={{
                        maxWidth: 500,
                        width: '90%',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(244,63,94,0.2)',
                        borderRadius: 16,
                        padding: '40px 36px',
                        textAlign: 'center',
                    }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
                        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
                            Something went wrong
                        </h1>
                        <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
                            An unexpected error occurred. Your data is safe — this is a display issue.
                        </p>

                        {/* Error details (collapsed by default) */}
                        {this.state.error && (
                            <details style={{
                                textAlign: 'left',
                                background: 'rgba(244,63,94,0.06)',
                                border: '1px solid rgba(244,63,94,0.15)',
                                borderRadius: 8,
                                padding: '10px 14px',
                                marginBottom: 20,
                                fontSize: 12,
                                color: '#f87171',
                            }}>
                                <summary style={{ cursor: 'pointer', color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>
                                    Error Details
                                </summary>
                                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                                    {this.state.error.toString()}
                                    {this.state.errorInfo?.componentStack && (
                                        <span style={{ color: '#64748b' }}>
                                            {'\n\nComponent Stack:'}
                                            {this.state.errorInfo.componentStack}
                                        </span>
                                    )}
                                </pre>
                            </details>
                        )}

                        {/* Recovery actions */}
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                            <button onClick={this.handleReload} style={{
                                padding: '10px 20px',
                                background: '#38bdf8',
                                color: '#0f172a',
                                border: 'none',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: 'pointer',
                            }}>
                                🔄 Reload Page
                            </button>
                            <button onClick={this.handleGoHome} style={{
                                padding: '10px 20px',
                                background: 'rgba(255,255,255,0.06)',
                                color: '#94a3b8',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}>
                                🏠 Go Home
                            </button>
                            <button onClick={this.handleDismiss} style={{
                                padding: '10px 20px',
                                background: 'rgba(255,255,255,0.06)',
                                color: '#94a3b8',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}>
                                ✕ Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
