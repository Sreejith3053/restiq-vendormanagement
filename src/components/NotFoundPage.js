// src/components/NotFoundPage.js
//
// Branded 404 page — replaces the plain <h2> fallback.
//
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useContext } from 'react';
import { UserContext } from '../contexts/UserContext';

export default function NotFoundPage() {
    const navigate = useNavigate();
    const { isSuperAdmin } = useContext(UserContext);
    const home = isSuperAdmin ? '/admin/forecast/control-tower' : '/';

    return (
        <div style={{
            minHeight: '70vh',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            color:          '#e2e8f0',
            fontFamily:     'Inter, sans-serif',
            textAlign:      'center',
            padding:        32,
        }}>
            {/* Large 404 glyph */}
            <div style={{
                fontSize:       96,
                fontWeight:     800,
                lineHeight:     1,
                background:     'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                marginBottom:   16,
                letterSpacing: -4,
            }}>
                404
            </div>

            <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: '#f1f5f9' }}>
                Page not found
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 32px', maxWidth: 360 }}>
                The page you're looking for doesn't exist or you may not have permission to access it.
            </p>

            <button
                onClick={() => navigate(home)}
                style={{
                    padding:      '10px 28px',
                    background:   'rgba(59,130,246,0.15)',
                    border:       '1px solid #3b82f6',
                    borderRadius: 10,
                    color:        '#60a5fa',
                    fontSize:     14,
                    fontWeight:   600,
                    cursor:       'pointer',
                    transition:   'all .2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.15)'}
            >
                ← Go to Dashboard
            </button>
        </div>
    );
}
