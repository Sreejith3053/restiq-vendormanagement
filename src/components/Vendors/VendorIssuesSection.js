import React, { useState, useEffect, useContext } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { toast } from 'react-toastify';

const ISSUE_TYPES = {
    missing_item:    { label: 'Missing Item',    icon: '❓', color: '#f59e0b' },
    incorrect_item:  { label: 'Incorrect Item',  icon: '🔄', color: '#f97316' },
    damaged_item:    { label: 'Damaged Item',    icon: '💥', color: '#ef4444' },
    short_quantity:  { label: 'Short Quantity',  icon: '📉', color: '#f43f5e' },
    wrong_pack_size: { label: 'Wrong Pack Size', icon: '📦', color: '#e879f9' },
    delivery_issue:  { label: 'Delivery Issue',  icon: '🚚', color: '#64748b' },
};

const STATUS_STYLES = {
    open:       { bg: 'rgba(244,63,94,0.12)', color: '#f43f5e', label: 'Open' },
    responded:  { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'Responded' },
    resolved:   { bg: 'rgba(16,185,129,0.12)', color: '#10b981', label: 'Resolved' },
    closed:     { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8', label: 'Closed' },
    disputed:   { bg: 'rgba(168,85,247,0.12)', color: '#a855f7', label: 'Disputed' },
};

export default function VendorIssuesSection() {
    const { vendorId } = useContext(UserContext);
    const [issues, setIssues] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIssue, setSelectedIssue] = useState(null);
    const [responseText, setResponseText] = useState('');
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState('active');

    useEffect(() => {
        if (!vendorId) { setLoading(false); return; }

        const q = query(
            collection(db, 'issuesDisputes'),
            where('vendorId', '==', vendorId)
        );

        const unsub = onSnapshot(q, (snap) => {
            const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            fetched.sort((a, b) => {
                const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
                const db2 = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
                return db2 - da;
            });
            setIssues(fetched);
            setLoading(false);
        }, (err) => {
            console.error('Error fetching vendor issues:', err);
            setLoading(false);
        });

        return () => unsub();
    }, [vendorId]);

    const formatDate = (ts) => {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const handleRespond = async () => {
        if (!responseText.trim()) { toast.warn('Please enter a response'); return; }
        setSaving(true);
        try {
            const ref = doc(db, 'issuesDisputes', selectedIssue.id);
            await updateDoc(ref, {
                status: 'responded',
                updatedAt: serverTimestamp(),
                vendorResponses: arrayUnion({
                    message: responseText,
                    respondedAt: new Date().toISOString(),
                    respondedBy: vendorId,
                }),
            });
            toast.success('Response submitted');
            setResponseText('');
        } catch (err) {
            console.error('Error responding:', err);
            toast.error('Failed to submit response');
        } finally {
            setSaving(false);
        }
    };

    const handleAction = async (action) => {
        setSaving(true);
        try {
            const ref = doc(db, 'issuesDisputes', selectedIssue.id);
            const updates = { updatedAt: serverTimestamp() };

            if (action === 'approve_replacement') {
                updates.status = 'resolved';
                updates.resolution = 'replacement_approved';
                updates.vendorResponses = arrayUnion({
                    message: 'Replacement approved by vendor',
                    respondedAt: new Date().toISOString(),
                    respondedBy: vendorId,
                    action: 'approve_replacement',
                });
            } else if (action === 'deny') {
                if (!responseText.trim()) { toast.warn('Please provide a reason for denial'); setSaving(false); return; }
                updates.status = 'disputed';
                updates.vendorResponses = arrayUnion({
                    message: responseText,
                    respondedAt: new Date().toISOString(),
                    respondedBy: vendorId,
                    action: 'denied',
                });
            } else if (action === 'resolve') {
                updates.status = 'resolved';
                updates.resolvedAt = serverTimestamp();
                updates.vendorResponses = arrayUnion({
                    message: responseText || 'Marked as resolved by vendor',
                    respondedAt: new Date().toISOString(),
                    respondedBy: vendorId,
                    action: 'resolved',
                });
            }

            await updateDoc(ref, updates);
            toast.success(`Issue ${action.replace('_', ' ')}`);
            setResponseText('');
        } catch (err) {
            console.error('Error updating issue:', err);
            toast.error('Failed to update');
        } finally {
            setSaving(false);
        }
    };

    const filtered = issues.filter(i => {
        if (filter === 'active') return !['resolved', 'closed'].includes(i.status);
        if (filter === 'resolved') return i.status === 'resolved' || i.status === 'closed';
        return true;
    });

    const openCount = issues.filter(i => i.status === 'open').length;
    const respondedCount = issues.filter(i => i.status === 'responded').length;

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading issues...</div>;

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>Issue Responses</h1>
                    <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>View and respond to delivery or quality issues raised by restaurants or admins.</p>
                </div>
                {openCount > 0 && (
                    <div style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e', padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                        {openCount} Open Issue{openCount > 1 ? 's' : ''}
                    </div>
                )}
            </div>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {[
                    { key: 'active', label: `Active (${openCount + respondedCount})` },
                    { key: 'resolved', label: 'Resolved' },
                    { key: 'all', label: 'All' },
                ].map(f => (
                    <button key={f.key} onClick={() => setFilter(f.key)} style={{
                        padding: '6px 16px', borderRadius: 6, border: '1px solid',
                        borderColor: filter === f.key ? '#38bdf8' : 'rgba(255,255,255,0.1)',
                        background: filter === f.key ? 'rgba(56,189,248,0.1)' : 'transparent',
                        color: filter === f.key ? '#38bdf8' : '#94a3b8',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}>{f.label}</button>
                ))}
            </div>

            {/* Issues List */}
            {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60 }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>No {filter === 'all' ? '' : filter + ' '}issues</div>
                    <div style={{ color: '#64748b', fontSize: 14 }}>
                        {filter === 'active' ? 'All issues have been resolved. Great job!' : 'No issues have been raised for your dispatches.'}
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {filtered.map(issue => {
                        const it = ISSUE_TYPES[issue.issueType] || { label: issue.issueType || 'Unknown', icon: '❓', color: '#94a3b8' };
                        const ss = STATUS_STYLES[issue.status] || STATUS_STYLES.open;
                        const isSelected = selectedIssue?.id === issue.id;

                        return (
                            <div key={issue.id}
                                onClick={() => setSelectedIssue(isSelected ? null : issue)}
                                style={{
                                    background: isSelected ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                                    border: `1px solid ${isSelected ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.06)'}`,
                                    borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                                    overflow: 'hidden',
                                }}>
                                {/* Issue Header */}
                                <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontSize: 20 }}>{it.icon}</span>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 14 }}>{it.label}</div>
                                            <div style={{ fontSize: 12, color: '#94a3b8' }}>
                                                {issue.itemName && <span>{issue.itemName} • </span>}
                                                {issue.dispatchId && <span>Dispatch: {issue.dispatchId.slice(-6)} • </span>}
                                                {formatDate(issue.createdAt)}
                                            </div>
                                        </div>
                                    </div>
                                    <span style={{ background: ss.bg, color: ss.color, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                                        {ss.label}
                                    </span>
                                </div>

                                {/* Expanded Detail */}
                                {isSelected && (
                                    <div style={{ padding: '0 20px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }} onClick={(e) => e.stopPropagation()}>
                                        {/* Description */}
                                        {issue.description && (
                                            <div style={{ padding: '12px 0', color: '#e2e8f0', fontSize: 14, lineHeight: 1.6 }}>
                                                {issue.description}
                                            </div>
                                        )}

                                        {/* Affected Info */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '12px 0' }}>
                                            {issue.itemName && (
                                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>
                                                    <span style={{ color: '#94a3b8' }}>Item: </span><span style={{ color: '#e2e8f0', fontWeight: 600 }}>{issue.itemName}</span>
                                                </div>
                                            )}
                                            {issue.quantity && (
                                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>
                                                    <span style={{ color: '#94a3b8' }}>Qty: </span><span style={{ color: '#e2e8f0', fontWeight: 600 }}>{issue.quantity}</span>
                                                </div>
                                            )}
                                            {issue.raisedBy && (
                                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>
                                                    <span style={{ color: '#94a3b8' }}>Raised by: </span><span style={{ color: '#e2e8f0', fontWeight: 600 }}>{issue.raisedBy}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Previous Responses */}
                                        {(issue.vendorResponses || []).length > 0 && (
                                            <div style={{ margin: '12px 0' }}>
                                                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>Previous Responses</div>
                                                {issue.vendorResponses.map((r, i) => (
                                                    <div key={i} style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.1)', padding: '8px 12px', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                                                        <div style={{ color: '#e2e8f0' }}>{r.message}</div>
                                                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{r.respondedAt} {r.action && `• ${r.action}`}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Response Input */}
                                        {issue.status !== 'resolved' && issue.status !== 'closed' && (
                                            <div style={{ marginTop: 12 }}>
                                                <textarea
                                                    className="ui-input"
                                                    value={responseText}
                                                    onChange={(e) => setResponseText(e.target.value)}
                                                    style={{ width: '100%', minHeight: 70, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: 12, borderRadius: 8, marginBottom: 12 }}
                                                    placeholder="Type your response..."
                                                />
                                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                    <button onClick={() => handleRespond()} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                                        💬 Respond
                                                    </button>
                                                    <button onClick={() => handleAction('approve_replacement')} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                                        ✅ Approve Replacement
                                                    </button>
                                                    <button onClick={() => handleAction('deny')} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                                        ❌ Deny
                                                    </button>
                                                    <button onClick={() => handleAction('resolve')} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                                        ✓ Mark Resolved
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
