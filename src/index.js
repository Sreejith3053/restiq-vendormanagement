// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { UserProvider } from './contexts/UserContext';

// Global styles
import './App.css';
import './styles/tokens.css';
import './styles/ui.css';

// ── Sentry Error Tracking ──────────────────────────────────────────────────
// Set REACT_APP_SENTRY_DSN in .env.production to enable.
// Sentry is silently disabled when DSN is not provided (dev / missing env).
import * as Sentry from '@sentry/react';
if (process.env.REACT_APP_SENTRY_DSN) {
    Sentry.init({
        dsn:         process.env.REACT_APP_SENTRY_DSN,
        environment: process.env.REACT_APP_ENV || 'development',
        // Only send 20% of transactions in production to stay within free tier
        tracesSampleRate: process.env.REACT_APP_ENV === 'production' ? 0.2 : 0,
        // Mask user PII in breadcrumbs
        beforeBreadcrumb(breadcrumb) {
            if (breadcrumb.category === 'ui.input') return null;
            return breadcrumb;
        },
    });
}

const root = ReactDOM.createRoot(document.getElementById('root'));


root.render(
    <BrowserRouter>
        <UserProvider>
            <App />
        </UserProvider>
    </BrowserRouter>
);
