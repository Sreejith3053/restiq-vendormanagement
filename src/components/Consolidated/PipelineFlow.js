import React from 'react';

/**
 * PipelineFlow — Horizontal order pipeline with stage cards and flowing arrows.
 *
 * Props:
 *   stages — [{ label, value, icon, color, tooltip, onClick }]
 */
export default function PipelineFlow({ stages = [] }) {
    if (!stages.length) return null;

    return (
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', width: '100%' }}>
            {stages.map((stage, i) => (
                <React.Fragment key={stage.label}>
                    <div
                        onClick={stage.onClick}
                        title={stage.tooltip}
                        style={{
                            flex: 1,
                            background: `${stage.color}0a`,
                            border: `1px solid ${stage.color}20`,
                            borderRadius: 10,
                            padding: '16px 10px 14px',
                            cursor: stage.onClick ? 'pointer' : 'default',
                            transition: 'all 0.2s',
                            textAlign: 'center',
                            position: 'relative',
                            minWidth: 0,
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.border = `1px solid ${stage.color}55`;
                            e.currentTarget.style.background = `${stage.color}14`;
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = `0 4px 16px ${stage.color}18`;
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.border = `1px solid ${stage.color}20`;
                            e.currentTarget.style.background = `${stage.color}0a`;
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    >
                        <div style={{ fontSize: 20, marginBottom: 6, lineHeight: 1 }}>{stage.icon}</div>
                        <div style={{
                            fontSize: 28, fontWeight: 800, color: stage.color,
                            lineHeight: 1.1, marginBottom: 6,
                            textShadow: `0 0 20px ${stage.color}30`,
                        }}>
                            {stage.value}
                        </div>
                        <div style={{
                            fontSize: 10, color: '#94a3b8', fontWeight: 600,
                            textTransform: 'uppercase', letterSpacing: 0.3, lineHeight: 1.3,
                        }}>
                            {stage.label}
                        </div>
                    </div>
                    {/* Arrow between stages */}
                    {i < stages.length - 1 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', padding: '0 2px',
                            color: '#334155', fontSize: 16, fontWeight: 700,
                            flexShrink: 0,
                        }}>
                            <svg width="20" height="16" viewBox="0 0 20 16" fill="none" style={{ opacity: 0.5 }}>
                                <path d="M0 8H16M16 8L10 2M16 8L10 14" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}
