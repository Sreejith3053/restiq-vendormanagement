/**
 * RiskFlagsPanel.js
 * Displays color-coded risk flags for a review item.
 */
import React from 'react';

function flagColor(flag) {
    if (flag.startsWith('🚨')) return { color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.25)' };
    if (flag.startsWith('⚠️')) return { color: '#fbbf24', bg: 'rgba(251,191,36,0.09)', border: 'rgba(251,191,36,0.22)' };
    if (flag.startsWith('🔄')) return { color: '#a78bfa', bg: 'rgba(167,139,250,0.09)', border: 'rgba(167,139,250,0.22)' };
    if (flag.startsWith('🔀')) return { color: '#f43f5e', bg: 'rgba(244,63,94,0.09)', border: 'rgba(244,63,94,0.22)' };
    if (flag.startsWith('📦')) return { color: '#38bdf8', bg: 'rgba(56,189,248,0.09)', border: 'rgba(56,189,248,0.2)' };
    return { color: '#94a3b8', bg: 'rgba(148,163,184,0.07)', border: 'rgba(148,163,184,0.18)' };
}

export default function RiskFlagsPanel({ flags = [] }) {
    if (!flags || flags.length === 0) {
        return (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)', fontSize: 12, color: '#4ade80' }}>
                ✅ No risk flags detected
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flags.map((flag, i) => {
                const { color, bg, border } = flagColor(flag);
                return (
                    <div key={i} style={{
                        padding: '8px 12px', borderRadius: 8,
                        background: bg, border: '1px solid ' + border,
                        fontSize: 12, color, lineHeight: 1.5,
                        fontWeight: 500,
                    }}>
                        {flag}
                    </div>
                );
            })}
        </div>
    );
}
