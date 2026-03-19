/**
 * Timeline.js — Reusable vertical timeline for orders, items, payouts.
 *
 * Usage:
 *   <Timeline events={[
 *     { label: 'Sent', timestamp: sentAt, icon: '📩', color: '#f59e0b' },
 *     { label: 'Confirmed', timestamp: confirmedAt, icon: '✅', color: '#10b981' },
 *   ]} />
 */
import React from 'react';

const formatTimestamp = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function Timeline({ events = [], compact = false }) {
    // Filter out events without timestamps (they haven't happened yet)
    const completed = events.filter(e => e.timestamp);
    const pending = events.filter(e => !e.timestamp);

    return (
        <div style={{ position: 'relative', padding: compact ? '4px 0' : '8px 0' }}>
            {/* Completed events */}
            {completed.map((event, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: compact ? 8 : 14, position: 'relative' }}>
                    {/* Vertical line */}
                    {i < completed.length - 1 && (
                        <div style={{
                            position: 'absolute',
                            left: compact ? 9 : 11,
                            top: compact ? 18 : 22,
                            width: 2,
                            height: compact ? 16 : 22,
                            background: event.color || '#38bdf8',
                            opacity: 0.3,
                        }} />
                    )}
                    {/* Dot */}
                    <div style={{
                        width: compact ? 18 : 22,
                        height: compact ? 18 : 22,
                        borderRadius: '50%',
                        background: `${event.color || '#38bdf8'}20`,
                        border: `2px solid ${event.color || '#38bdf8'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: compact ? 10 : 12,
                        flexShrink: 0,
                    }}>
                        {event.icon || '●'}
                    </div>
                    {/* Content */}
                    <div>
                        <div style={{ fontSize: compact ? 12 : 13, fontWeight: 600, color: '#f8fafc' }}>
                            {event.label}
                        </div>
                        <div style={{ fontSize: compact ? 10 : 11, color: '#64748b', marginTop: 1 }}>
                            {formatTimestamp(event.timestamp)}
                        </div>
                    </div>
                </div>
            ))}

            {/* Pending events (no timestamp yet) */}
            {pending.map((event, i) => (
                <div key={`pending-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: compact ? 8 : 14, opacity: 0.35 }}>
                    {/* Connecting line */}
                    {(completed.length > 0 || i > 0) && i === 0 && completed.length > 0 && (
                        <div style={{
                            position: 'absolute',
                            left: compact ? 9 : 11,
                            top: -6,
                            width: 2,
                            height: compact ? 14 : 18,
                            background: '#475569',
                        }} />
                    )}
                    <div style={{
                        width: compact ? 18 : 22,
                        height: compact ? 18 : 22,
                        borderRadius: '50%',
                        background: 'transparent',
                        border: '2px dashed #475569',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: compact ? 10 : 12,
                        flexShrink: 0,
                    }}>
                        {event.icon || '○'}
                    </div>
                    <div>
                        <div style={{ fontSize: compact ? 12 : 13, fontWeight: 500, color: '#64748b' }}>
                            {event.label}
                        </div>
                        <div style={{ fontSize: compact ? 10 : 11, color: '#475569', marginTop: 1 }}>
                            Pending
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Build a dispatch timeline from a dispatch document */
export function buildDispatchTimeline(dispatch) {
    return [
        { label: 'Sent', timestamp: dispatch.sentAt, icon: '📩', color: '#f59e0b' },
        { label: 'Confirmed', timestamp: dispatch.confirmedAt, icon: '✅', color: '#38bdf8' },
        { label: 'Packed', timestamp: dispatch.packedAt, icon: '📦', color: '#6366f1' },
        { label: 'Delivered', timestamp: dispatch.deliveredAt, icon: '✓', color: '#10b981' },
    ];
}

/** Build a payout timeline from an invoice document */
export function buildPayoutTimeline(invoice) {
    return [
        { label: 'Generated', timestamp: invoice.createdAt, icon: '📄', color: '#38bdf8' },
        { label: 'Updated', timestamp: invoice.updatedAt !== invoice.createdAt ? invoice.updatedAt : null, icon: '✏️', color: '#a855f7' },
        { label: 'Paid', timestamp: invoice.paidAt, icon: '💰', color: '#10b981' },
    ];
}
