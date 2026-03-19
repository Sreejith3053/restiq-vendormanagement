/**
 * GuidanceText.js — Actionable insight text under metrics.
 *
 * Replaces raw "2 orders pending" with "Confirm within 4h to maintain score".
 * Subtle styling — does not dominate the UI.
 */
import React from 'react';

const TYPE_STYLES = {
    info:    { color: '#38bdf8', bg: 'rgba(56,189,248,0.06)',  border: 'rgba(56,189,248,0.12)', icon: 'ℹ️' },
    warning: { color: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.12)', icon: '⚠️' },
    success: { color: '#10b981', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.12)', icon: '✅' },
    danger:  { color: '#f43f5e', bg: 'rgba(244,63,94,0.06)',  border: 'rgba(244,63,94,0.12)',  icon: '🚨' },
    muted:   { color: '#94a3b8', bg: 'transparent',            border: 'transparent',           icon: '💡' },
};

export default function GuidanceText({ text, type = 'info', icon, style: extraStyle, compact = false }) {
    if (!text) return null;

    const s = TYPE_STYLES[type] || TYPE_STYLES.info;
    const displayIcon = icon !== undefined ? icon : s.icon;

    if (compact) {
        return (
            <div style={{
                fontSize: 11,
                color: s.color,
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                ...extraStyle,
            }}>
                {displayIcon && <span style={{ fontSize: 10 }}>{displayIcon}</span>}
                {text}
            </div>
        );
    }

    return (
        <div style={{
            fontSize: 12,
            color: s.color,
            background: s.bg,
            border: `1px solid ${s.border}`,
            borderRadius: 8,
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            lineHeight: 1.5,
            ...extraStyle,
        }}>
            {displayIcon && <span style={{ fontSize: 13 }}>{displayIcon}</span>}
            <span>{text}</span>
        </div>
    );
}

/** Generate time-aware guidance text */
export function timeAgoText(timestamp) {
    if (!timestamp) return null;
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffMs = Date.now() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);

    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    if (diffD === 1) return '1 day ago';
    return `${diffD} days ago`;
}

/** Generate pending duration label */
export function pendingDuration(timestamp) {
    if (!timestamp) return null;
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffMs = Date.now() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);

    if (diffH < 1) return { text: '<1h', level: 'success' };
    if (diffH < 4) return { text: `${diffH}h`, level: 'info' };
    if (diffH < 24) return { text: `${diffH}h`, level: 'warning' };
    if (diffD < 3) return { text: `${diffD}d`, level: 'warning' };
    return { text: `${diffD}d`, level: 'danger' };
}
