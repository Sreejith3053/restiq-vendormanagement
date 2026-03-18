/**
 * BulkReviewActionsBar.js
 *
 * Sticky bar that appears when rows are selected in the review queue.
 * Provides bulk Hold / Reject / Map to Category actions.
 */
import React, { useState } from 'react';

export default function BulkReviewActionsBar({ selectedIds = [], onBulkHold, onBulkReject, onClearSelection }) {
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [busy, setBusy] = useState(false);

    if (selectedIds.length === 0) return null;

    const count = selectedIds.length;

    const handleHold = async () => {
        setBusy(true);
        await onBulkHold(selectedIds, 'Bulk held by admin');
        onClearSelection();
        setBusy(false);
    };

    const handleReject = async () => {
        if (!rejectReason.trim()) return;
        setBusy(true);
        await onBulkReject(selectedIds, rejectReason.trim());
        setShowRejectInput(false);
        setRejectReason('');
        onClearSelection();
        setBusy(false);
    };

    return (
        <div style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9000,
            background: '#1e293b', borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            padding: '14px 20px', minWidth: 420,
            display: 'flex', flexDirection: 'column', gap: 10,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: 13 }}>
                    {count} row{count !== 1 ? 's' : ''} selected
                </span>
                <button
                    onClick={onClearSelection}
                    style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16 }}
                >✕</button>
            </div>

            {!showRejectInput ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                        onClick={handleHold}
                        disabled={busy}
                        style={{
                            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                            cursor: busy ? 'not-allowed' : 'pointer',
                        }}
                    >
                        🕐 Hold ({count})
                    </button>
                    <button
                        onClick={() => setShowRejectInput(true)}
                        disabled={busy}
                        style={{
                            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            border: '1px solid rgba(244,63,94,0.4)', background: 'rgba(244,63,94,0.1)', color: '#f43f5e',
                            cursor: busy ? 'not-allowed' : 'pointer',
                        }}
                    >
                        ❌ Reject ({count})
                    </button>
                </div>
            ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        type="text"
                        placeholder="Rejection reason..."
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        style={{
                            flex: 1, padding: '6px 10px', borderRadius: 7,
                            border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a',
                            color: '#f8fafc', fontSize: 12,
                        }}
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleReject()}
                    />
                    <button onClick={handleReject} disabled={!rejectReason.trim() || busy}
                        style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#f43f5e', border: 'none', color: '#fff', cursor: 'pointer' }}>
                        Confirm
                    </button>
                    <button onClick={() => setShowRejectInput(false)}
                        style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer' }}>
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}
