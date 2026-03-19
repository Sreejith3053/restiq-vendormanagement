import React from 'react';

/**
 * SectionContainer — Consistent section wrapper with title, icon, optional CTA.
 *
 * Props:
 *   title      — section heading
 *   icon       — emoji or react-icon
 *   subtitle   — optional description
 *   cta        — { label, onClick } optional action button
 *   accent     — border accent color (default transparent)
 *   compact    — reduce internal padding
 *   style      — override container styles
 */
export default function SectionContainer({ title, icon, subtitle, cta, accent, compact, children, style = {} }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: `1px solid ${accent ? accent + '22' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: 12,
            padding: compact ? '14px 16px' : '20px 22px',
            ...style,
        }}>
            {(title || cta) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? 10 : 16 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
                            <h3 style={{ margin: 0, fontSize: compact ? 13 : 14, fontWeight: 700, color: '#e2e8f0' }}>{title}</h3>
                        </div>
                        {subtitle && <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{subtitle}</div>}
                    </div>
                    {cta && (
                        <button onClick={cta.onClick} style={{
                            padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                            border: `1px solid ${accent || '#38bdf8'}33`, background: `${accent || '#38bdf8'}0a`,
                            color: accent || '#38bdf8', transition: 'all 0.2s', whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${accent || '#38bdf8'}1a`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = `${accent || '#38bdf8'}0a`; }}>
                            {cta.label} →
                        </button>
                    )}
                </div>
            )}
            {children}
        </div>
    );
}
