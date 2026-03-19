import React from 'react';

/**
 * AlertCardRow — Horizontal strip of warning/alert cards.
 * Only renders cards whose count > 0. Hidden entirely if no alerts.
 *
 * Props:
 *   alerts — [{ label, count, icon, color, onClick }]
 */
export default function AlertCardRow({ alerts = [] }) {
    const active = alerts.filter(a => a.count > 0);
    if (!active.length) {
        return (
            <div style={{
                background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)',
                borderRadius: 10, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, color: '#34d399', fontWeight: 600, marginBottom: 20,
            }}>
                ✅ No operational issues — system running clean
            </div>
        );
    }

    return (
        <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${Math.min(active.length, 5)}, 1fr)`,
            gap: 10, marginBottom: 20,
        }}>
            {active.map(a => (
                <div
                    key={a.label}
                    onClick={a.onClick}
                    style={{
                        background: `${a.color}08`, border: `1px solid ${a.color}25`,
                        borderLeft: `3px solid ${a.color}`,
                        borderRadius: 8, padding: '12px 14px',
                        cursor: a.onClick ? 'pointer' : 'default',
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.background = `${a.color}14`;
                        e.currentTarget.style.borderColor = `${a.color}44`;
                        e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.background = `${a.color}08`;
                        e.currentTarget.style.borderColor = `${a.color}25`;
                        e.currentTarget.style.transform = 'translateY(0)';
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14 }}>{a.icon}</span>
                        <span style={{ fontSize: 20, fontWeight: 800, color: a.color }}>{a.count}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{a.label}</div>
                </div>
            ))}
        </div>
    );
}
