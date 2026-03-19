import React from 'react';

/**
 * CTAButtonGroup — Row of navigation action buttons.
 *
 * Props:
 *   buttons — [{ label, icon, to, color }]
 */
export default function CTAButtonGroup({ buttons = [] }) {
    if (!buttons.length) return null;

    return (
        <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${buttons.length}, 1fr)`,
            gap: 10,
        }}>
            {buttons.map(btn => (
                <div
                    key={btn.label}
                    onClick={() => window.location.href = btn.to}
                    style={{
                        background: `${btn.color}06`,
                        border: `1px solid ${btn.color}20`,
                        borderRadius: 10,
                        padding: '14px 16px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.border = `1px solid ${btn.color}55`;
                        e.currentTarget.style.background = `${btn.color}12`;
                        e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.border = `1px solid ${btn.color}20`;
                        e.currentTarget.style.background = `${btn.color}06`;
                        e.currentTarget.style.transform = 'translateY(0)';
                    }}
                >
                    <span style={{ fontSize: 18 }}>{btn.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: btn.color }}>{btn.label} →</span>
                </div>
            ))}
        </div>
    );
}
