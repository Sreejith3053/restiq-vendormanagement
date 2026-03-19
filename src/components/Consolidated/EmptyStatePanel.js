import React from 'react';

/**
 * EmptyStatePanel — Reusable empty state for tabs with no data.
 * Usage: <EmptyStatePanel icon="📦" title="No items" description="..." actionLabel="Add Item" onAction={fn} />
 */
export default function EmptyStatePanel({ icon = '📭', title = 'No data yet', description = '', actionLabel, onAction, style = {} }) {
    return (
        <div style={{ padding: '50px 30px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, ...style }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>{icon}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{title}</div>
            {description && <div style={{ fontSize: 13, color: '#64748b', maxWidth: 420, margin: '0 auto 16px auto', lineHeight: 1.5 }}>{description}</div>}
            {actionLabel && onAction && (
                <button onClick={onAction} style={{
                    padding: '8px 22px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(56,189,248,0.3)',
                    background: 'rgba(56,189,248,0.1)', color: '#38bdf8', transition: 'all 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(56,189,248,0.1)'}>
                    {actionLabel}
                </button>
            )}
        </div>
    );
}
