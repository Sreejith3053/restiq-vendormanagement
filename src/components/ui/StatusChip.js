/**
 * StatusChip.js — Reusable status badge with standardized colors.
 *
 * Color system:
 *   Pending     → Yellow
 *   Confirmed   → Blue
 *   In Progress → Purple
 *   Delivered   → Green
 *   Issue       → Red
 *   Warning     → Orange
 *   Default     → Gray
 */
import React from 'react';

const STATUS_STYLES = {
    // Canonical statuses
    pending:            { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
    sent:               { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
    reviewing:          { bg: 'rgba(168,85,247,0.12)', color: '#a855f7' },
    'vendor reviewing': { bg: 'rgba(168,85,247,0.12)', color: '#a855f7' },
    'in-review':        { bg: 'rgba(168,85,247,0.12)', color: '#a855f7' },
    confirmed:          { bg: 'rgba(56,189,248,0.12)',  color: '#38bdf8' },
    'partially confirmed': { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
    packed:             { bg: 'rgba(99,102,241,0.12)',  color: '#6366f1' },
    'in progress':      { bg: 'rgba(99,102,241,0.12)',  color: '#6366f1' },
    'out for delivery': { bg: 'rgba(14,165,233,0.12)',  color: '#0ea5e9' },
    delivered:          { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
    completed:          { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
    fulfilled:          { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
    paid:               { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
    active:             { bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
    rejected:           { bg: 'rgba(244,63,94,0.12)',   color: '#f43f5e' },
    issue:              { bg: 'rgba(244,63,94,0.12)',   color: '#f43f5e' },
    failed:             { bg: 'rgba(244,63,94,0.12)',   color: '#f43f5e' },
    overdue:            { bg: 'rgba(244,63,94,0.12)',   color: '#f43f5e' },
    disputed:           { bg: 'rgba(244,63,94,0.12)',   color: '#f43f5e' },
    warning:            { bg: 'rgba(251,146,60,0.12)',  color: '#fb923c' },
    partial:            { bg: 'rgba(168,85,247,0.12)',  color: '#a855f7' },
    voided:             { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' },
    inactive:           { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' },
    draft:              { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' },
    // Marketplace-specific
    'pending customer approval': { bg: 'rgba(244,114,182,0.12)', color: '#f472b6' },
    'cancelled by customer':     { bg: 'rgba(244,63,94,0.12)',  color: '#f43f5e' },
};

const DEFAULT_STYLE = { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' };

export default function StatusChip({ status, label, size = 'md', icon }) {
    const key = (status || '').toLowerCase().trim();
    const style = STATUS_STYLES[key] || DEFAULT_STYLE;
    const displayLabel = label || status || 'Unknown';

    const sizes = {
        sm: { fontSize: 10, padding: '2px 8px' },
        md: { fontSize: 11, padding: '3px 10px' },
        lg: { fontSize: 13, padding: '4px 14px' },
    };

    const s = sizes[size] || sizes.md;

    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: style.bg,
            color: style.color,
            fontSize: s.fontSize,
            fontWeight: 700,
            padding: s.padding,
            borderRadius: 20,
            border: `1px solid ${style.color}22`,
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
            textTransform: 'capitalize',
        }}>
            {icon && <span style={{ fontSize: s.fontSize + 2 }}>{icon}</span>}
            {displayLabel}
        </span>
    );
}

/** Get raw style object for a status (for external use) */
export function getStatusStyle(status) {
    const key = (status || '').toLowerCase().trim();
    return STATUS_STYLES[key] || DEFAULT_STYLE;
}
