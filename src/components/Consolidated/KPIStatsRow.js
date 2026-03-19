import React from 'react';

/**
 * KPIStatsRow — Reusable row of KPI stat cards for consolidated pages.
 * Usage: <KPIStatsRow stats={[{ label, value, icon, color }]} />
 */
export default function KPIStatsRow({ stats = [], style = {} }) {
    if (!stats.length) return null;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(stats.length, 6)}, 1fr)`, gap: 12, marginBottom: 22, ...style }}>
            {stats.map((s, i) => (
                <div key={i} onClick={s.onClick} style={{
                    background: s.color ? `${s.color}08` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${s.color ? s.color + '22' : 'rgba(255,255,255,0.07)'}`,
                    borderRadius: 10, padding: '14px 16px',
                    cursor: s.onClick ? 'pointer' : 'default',
                    transition: 'all 0.2s',
                }}
                onMouseEnter={e => { if (s.onClick) { e.currentTarget.style.border = `1px solid ${s.color || '#38bdf8'}55`; e.currentTarget.style.background = `${s.color || '#38bdf8'}14`; }}}
                onMouseLeave={e => { e.currentTarget.style.border = `1px solid ${s.color ? s.color + '22' : 'rgba(255,255,255,0.07)'}`; e.currentTarget.style.background = s.color ? `${s.color}08` : 'rgba(255,255,255,0.03)'; }}>
                    {s.icon && <div style={{ fontSize: 16, marginBottom: 4 }}>{s.icon}</div>}
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color || '#f8fafc' }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 }}>{s.label}</div>
                </div>
            ))}
        </div>
    );
}
