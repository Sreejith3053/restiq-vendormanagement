/**
 * ReviewHistoryTimeline.js
 * Shows the action history for a single review queue item.
 */
import React from 'react';

function actionLabel(action) {
    const map = {
        approved_map_to_existing:         { label: 'Mapped to Catalog Item',        color: '#4ade80', emoji: '🔗' },
        approved_created_new_catalog_item:{ label: 'Created New Catalog Item',       color: '#38bdf8', emoji: '✨' },
        approved_high_risk_update:        { label: 'Approved High-Risk Update',      color: '#fbbf24', emoji: '✅' },
        merged_into_existing:             { label: 'Merged Into Existing Item',      color: '#a78bfa', emoji: '🔀' },
        rejected:                         { label: 'Rejected',                       color: '#f43f5e', emoji: '❌' },
        held:                             { label: 'Placed on Hold',                 color: '#fbbf24', emoji: '🕐' },
        edited:                           { label: 'Item Edited',                    color: '#94a3b8', emoji: '✏️' },
    };
    return map[action] || { label: action, color: '#94a3b8', emoji: '📝' };
}

function formatTs(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ReviewHistoryTimeline({ history = [], loading = false }) {
    if (loading) return <div style={{ fontSize: 12, color: '#475569', padding: 12 }}>Loading history...</div>;

    if (history.length === 0) {
        return <div style={{ fontSize: 12, color: '#334155', padding: '8px 0' }}>No actions taken yet.</div>;
    }

    return (
        <div style={{ position: 'relative', paddingLeft: 20 }}>
            {/* Vertical line */}
            <div style={{ position: 'absolute', left: 7, top: 0, bottom: 0, width: 2, background: 'rgba(255,255,255,0.05)' }} />

            {history.map((entry, idx) => {
                const { label, color, emoji } = actionLabel(entry.action);
                return (
                    <div key={entry.id || idx} style={{ position: 'relative', marginBottom: 16 }}>
                        {/* Dot */}
                        <div style={{
                            position: 'absolute', left: -20, top: 3,
                            width: 14, height: 14, borderRadius: '50%',
                            background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 8, zIndex: 1,
                        }}>
                            {emoji}
                        </div>

                        <div style={{
                            padding: '9px 12px', borderRadius: 8,
                            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                                <span style={{ fontWeight: 700, color, fontSize: 12 }}>{label}</span>
                                <span style={{ fontSize: 10, color: '#334155' }}>{formatTs(entry.actionAt)}</span>
                            </div>
                            {entry.actionBy && (
                                <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>By: {entry.actionBy}</div>
                            )}
                            {entry.notes && (
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{entry.notes}</div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
