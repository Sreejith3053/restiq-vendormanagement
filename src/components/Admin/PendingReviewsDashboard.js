import React, { useState, useEffect, useCallback, useContext } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, doc, updateDoc, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { logAdminChange } from '../../utils/adminAuditLogger';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

export default function PendingReviewsDashboard() {
    const { userId, displayName } = useContext(UserContext);
    const navigate = useNavigate();

    const [reviewItems, setReviewItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);
    const [rejectingId, setRejectingId] = useState(null);
    const [rejectComment, setRejectComment] = useState('');

    // Filters
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('in-review');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            const allReviews = [];

            for (const vDoc of vendorsSnap.docs) {
                const vendorName = vDoc.data().name || vDoc.data().companyName || vDoc.id;
                const itemsSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                itemsSnap.docs.forEach(iDoc => {
                    const item = iDoc.data();
                    if (item.status === 'in-review' || item.status === 'rejected') {
                        allReviews.push({
                            id: iDoc.id,
                            vendorId: vDoc.id,
                            vendorName,
                            ...item,
                        });
                    }
                });
            }

            // Sort: in-review first, then by requestedAt descending
            allReviews.sort((a, b) => {
                if (a.status === 'in-review' && b.status !== 'in-review') return -1;
                if (a.status !== 'in-review' && b.status === 'in-review') return 1;
                const tA = a.requestedAt?.toMillis?.() || a.requestedAt?.seconds * 1000 || 0;
                const tB = b.requestedAt?.toMillis?.() || b.requestedAt?.seconds * 1000 || 0;
                return tB - tA;
            });
            setReviewItems(allReviews);
        } catch (err) {
            toast.error('Failed to load reviews');
            console.error(err);
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ---------- AUDIT HELPER ----------
    const logItemAudit = async (vendorId, itemId, action, details = {}) => {
        try {
            await addDoc(collection(db, `vendors/${vendorId}/items/${itemId}/auditLog`), {
                action,
                ...details,
                performedBy: userId,
                performedByName: displayName || 'SuperAdmin',
                timestamp: serverTimestamp(),
            });
        } catch (err) { console.warn('Audit log failed:', err); }
    };

    // ---------- APPROVE ----------
    const handleApprove = async (item) => {
        setProcessingId(item.id);
        try {
            const itemRef = doc(db, `vendors/${item.vendorId}/items`, item.id);
            const clearFields = {
                status: 'active',
                rejectionComment: '',
                changeType: '',
                proposedData: null,
                originalData: null,
                requestedBy: '',
                requestedByName: '',
                requestedAt: null,
                updatedAt: serverTimestamp(),
            };

            if ((item.changeType === 'edit' || item.changeType === 'add' || item.changeType === 'deactivate') && item.proposedData) {
                if (item.changeType === 'deactivate') {
                    await updateDoc(itemRef, { ...clearFields, status: 'inactive' });
                } else {
                    await updateDoc(itemRef, { ...item.proposedData, ...clearFields });
                }
            } else if (item.changeType === 'delete') {
                await deleteDoc(itemRef);
            }

            await logItemAudit(item.vendorId, item.id, 'approved', {
                itemName: item.proposedData?.itemName || item.proposedData?.name || item.itemName || item.name,  // v2-first
                changeType: item.changeType,
                proposedData: item.proposedData,
                requestedBy: item.requestedByName,
            });
            await logAdminChange({ entityType: 'vendorItem', entityId: item.id, action: 'review_approved', changedBy: displayName, metadata: { vendorId: item.vendorId, changeType: item.changeType } });

            toast.success(`✅ ${item.changeType === 'delete' ? 'Deletion' : item.changeType === 'add' ? 'New item' : item.changeType === 'deactivate' ? 'Deactivation' : 'Edit'} approved!`);
            fetchData();
        } catch (err) {
            toast.error('Failed to approve: ' + err.message);
        } finally {
            setProcessingId(null);
        }
    };

    // ---------- REJECT ----------
    const handleReject = async (item) => {
        if (!rejectComment.trim()) { toast.warn('Please add a rejection comment.'); return; }
        setProcessingId(item.id);
        try {
            const itemRef = doc(db, `vendors/${item.vendorId}/items`, item.id);
            if (item.changeType === 'add') {
                await deleteDoc(itemRef);
            } else {
                await updateDoc(itemRef, {
                    status: 'rejected',
                    rejectionComment: rejectComment.trim(),
                    changeType: '',
                    proposedData: null,
                    originalData: null,
                });
            }

            await logItemAudit(item.vendorId, item.id, 'rejected', {
                itemName: item.itemName || item.name,  // v2-first
                rejectionComment: rejectComment.trim(),
                requestedBy: item.requestedByName,
            });
            await logAdminChange({ entityType: 'vendorItem', entityId: item.id, action: 'review_rejected', changedBy: displayName, metadata: { vendorId: item.vendorId } });

            setRejectingId(null);
            setRejectComment('');
            toast.info('❌ Change request rejected.');
            fetchData();
        } catch (err) {
            toast.error('Failed to reject: ' + err.message);
        } finally {
            setProcessingId(null);
        }
    };

    const formatDate = (ts) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // ---------- FILTERS ----------
    const filtered = reviewItems.filter(item => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (typeFilter !== 'all' && item.changeType !== typeFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            return (item.itemName || item.name || '').toLowerCase().includes(q) ||          // v2-first
                (item.proposedData?.itemName || item.proposedData?.name || '').toLowerCase().includes(q) ||
                (item.vendorName || '').toLowerCase().includes(q) ||
                (item.requestedByName || '').toLowerCase().includes(q);
        }
        return true;
    });

    const counts = {
        total: reviewItems.length,
        pending: reviewItems.filter(r => r.status === 'in-review').length,
        rejected: reviewItems.filter(r => r.status === 'rejected').length,
        edits: reviewItems.filter(r => r.changeType === 'edit').length,
        adds: reviewItems.filter(r => r.changeType === 'add').length,
        deletes: reviewItems.filter(r => r.changeType === 'delete').length,
        deactivates: reviewItems.filter(r => r.changeType === 'deactivate').length,
    };

    const changeTypeColors = { edit: '#38bdf8', add: '#10b981', delete: '#f43f5e', deactivate: '#fbbf24' };
    const changeTypeIcons = { edit: '✏️', add: '🆕', delete: '🗑️', deactivate: '⏸️' };
    const changeTypeLabels = { edit: 'Edit', add: 'New Item', delete: 'Delete', deactivate: 'Deactivate' };

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc' }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>📋 Pending Reviews</h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
                    All vendor item change requests across the marketplace
                </p>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                {[
                    { label: 'Pending', value: counts.pending, color: '#fbbf24', icon: '⏳' },
                    { label: 'Rejected', value: counts.rejected, color: '#f43f5e', icon: '❌' },
                    { label: 'Edits', value: counts.edits, color: '#38bdf8', icon: '✏️' },
                    { label: 'New Items', value: counts.adds, color: '#10b981', icon: '🆕' },
                    { label: 'Deletes', value: counts.deletes, color: '#f43f5e', icon: '🗑️' },
                    { label: 'Deactivations', value: counts.deactivates, color: '#fbbf24', icon: '⏸️' },
                ].map(s => (
                    <div key={s.label} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px 20px', minWidth: 100 }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{loading ? '…' : s.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.icon} {s.label}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <input placeholder="Search item, vendor, requester..." value={search} onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 240 }} />
                {['in-review', 'rejected', 'all'].map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                        style={{ padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: statusFilter === s ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)', background: statusFilter === s ? 'rgba(56,189,248,0.15)' : 'transparent', color: statusFilter === s ? '#38bdf8' : '#94a3b8' }}>
                        {s === 'in-review' ? 'Pending' : s === 'all' ? 'All' : 'Rejected'}
                    </button>
                ))}
                <span style={{ color: '#334155' }}>|</span>
                {['all', 'edit', 'add', 'delete', 'deactivate'].map(t => (
                    <button key={t} onClick={() => setTypeFilter(t)}
                        style={{ padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: typeFilter === t ? `1px solid ${changeTypeColors[t] || '#38bdf8'}` : '1px solid rgba(255,255,255,0.08)', background: typeFilter === t ? `${(changeTypeColors[t] || '#38bdf8')}18` : 'transparent', color: typeFilter === t ? (changeTypeColors[t] || '#38bdf8') : '#94a3b8' }}>
                        {t === 'all' ? 'All types' : changeTypeLabels[t]}
                    </button>
                ))}
                <span style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>{filtered.length} showing</span>
            </div>

            {/* Review Cards */}
            {loading ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>Loading reviews across all vendors...</div>
            ) : filtered.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>{counts.pending === 0 ? '🎉' : '📋'}</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{counts.pending === 0 ? 'No pending reviews!' : 'No items match your filters.'}</div>
                    <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{counts.pending === 0 ? 'All vendor change requests have been processed.' : 'Try changing your filter criteria.'}</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filtered.map(item => {
                        const ct = item.changeType || 'edit';
                        const isRejecting = rejectingId === item.id;

                        return (
                            <div key={`${item.vendorId}-${item.id}`} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, transition: 'border-color 0.15s' }}>
                                {/* Top row: badges + item info */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: `${changeTypeColors[ct]}18`, color: changeTypeColors[ct], border: `1px solid ${changeTypeColors[ct]}33` }}>
                                                {changeTypeIcons[ct]} {changeTypeLabels[ct] || ct}
                                            </span>
                                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: item.status === 'in-review' ? 'rgba(251,191,36,0.1)' : 'rgba(244,63,94,0.1)', color: item.status === 'in-review' ? '#fbbf24' : '#f43f5e', border: `1px solid ${item.status === 'in-review' ? '#fbbf2433' : '#f43f5e33'}` }}>
                                                {item.status === 'in-review' ? '⏳ Pending' : '❌ Rejected'}
                                            </span>
                                        </div>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: '#f8fafc' }}>
                                            {item.proposedData?.itemName || item.proposedData?.name || item.itemName || item.name || 'Unknown Item'}
                                        </div>
                                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                                            <span style={{ cursor: 'pointer', color: '#38bdf8', fontWeight: 600 }} onClick={() => navigate(`/vendors/${item.vendorId}`)}>
                                                {item.vendorName}
                                            </span>
                                            <span style={{ color: '#475569' }}> • </span>
                                            Requested by <strong style={{ color: '#cbd5e1' }}>{item.requestedByName || 'Unknown'}</strong>
                                            <span style={{ color: '#475569' }}> • </span>
                                            {formatDate(item.requestedAt)}
                                        </div>
                                    </div>

                                    {/* Right: quick price info if available */}
                                    {item.proposedData?.vendorPrice !== undefined && item.originalData?.vendorPrice !== undefined && (
                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                            <div style={{ fontSize: 11, color: '#94a3b8' }}>Price Change</div>
                                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                <span style={{ fontSize: 14, color: '#f43f5e', textDecoration: 'line-through' }}>${Number(item.originalData.vendorPrice).toFixed(2)}</span>
                                                <span style={{ color: '#475569' }}>→</span>
                                                <span style={{ fontSize: 16, fontWeight: 700, color: '#10b981' }}>${Number(item.proposedData.vendorPrice).toFixed(2)}</span>
                                            </div>
                                            {(() => {
                                                const diff = Number(item.proposedData.vendorPrice) - Number(item.originalData.vendorPrice);
                                                const pct = Number(item.originalData.vendorPrice) > 0 ? ((diff / Number(item.originalData.vendorPrice)) * 100).toFixed(1) : 0;
                                                return (
                                                    <div style={{ fontSize: 11, color: diff > 0 ? '#f43f5e' : '#10b981', fontWeight: 600 }}>
                                                        {diff > 0 ? '▲' : '▼'} {Math.abs(pct)}%
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>

                                {/* Diff table for edits / adds */}
                                {(ct === 'edit' || ct === 'add') && item.proposedData && (
                                    <div style={{ marginTop: 12, overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <th style={{ padding: '5px 10px', textAlign: 'left', color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Field</th>
                                                    <th style={{ padding: '5px 10px', textAlign: 'left', color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Current</th>
                                                    <th style={{ padding: '5px 10px', textAlign: 'left', color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Proposed</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {Object.keys(item.proposedData).filter(f => f !== 'createdAt').map(field => {
                                                    const orig = String(item.originalData?.[field] ?? '');
                                                    const proposed = String(item.proposedData[field] ?? '');
                                                    if (orig === proposed && ct !== 'add') return null;
                                                    return (
                                                        <tr key={field} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                                            <td style={{ padding: '4px 10px', fontWeight: 600, color: '#94a3b8', textTransform: 'capitalize' }}>{field}</td>
                                                            <td style={{ padding: '4px 10px', color: '#f43f5e', textDecoration: ct === 'add' ? 'none' : 'line-through' }}>
                                                                {ct === 'add' ? '—' : ((field === 'vendorPrice' || field === 'price') ? `$${Number(orig).toFixed(2)}` : orig || '—')}
                                                            </td>
                                                            <td style={{ padding: '4px 10px', color: '#10b981' }}>
                                                                {(field === 'vendorPrice' || field === 'price') ? `$${Number(proposed).toFixed(2)}` : proposed || '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Delete summary */}
                                {ct === 'delete' && item.originalData && (
                                    <div style={{ marginTop: 10, fontSize: 13, color: '#f43f5e', background: 'rgba(244,63,94,0.06)', padding: '8px 14px', borderRadius: 8 }}>
                                        ⚠️ Delete <strong>{item.originalData.itemName || item.originalData.name}</strong> ({item.originalData.category}, ${Number(item.originalData.vendorPrice ?? 0).toFixed(2)}/{item.originalData.baseUnit || item.originalData.unit})
                                    </div>
                                )}

                                {/* Deactivate summary */}
                                {ct === 'deactivate' && (
                                    <div style={{ marginTop: 10, fontSize: 13, color: '#fbbf24', background: 'rgba(251,191,36,0.06)', padding: '8px 14px', borderRadius: 8 }}>
                                        ⏸️ Deactivate <strong>{item.itemName || item.name}</strong>
                                    </div>
                                )}

                                {/* Proof uploads */}
                                {item.proofUrls && item.proofUrls.length > 0 && (
                                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span style={{ fontSize: 11, color: '#94a3b8' }}>📎 Proof:</span>
                                        {item.proofUrls.map((p, i) => (
                                            <a key={i} href={p.url} target="_blank" rel="noopener noreferrer"
                                                style={{ fontSize: 11, color: '#38bdf8', textDecoration: 'underline' }}>{p.name}</a>
                                        ))}
                                    </div>
                                )}

                                {/* Rejection comment */}
                                {item.status === 'rejected' && item.rejectionComment && (
                                    <div style={{ marginTop: 10, fontSize: 12, color: '#f43f5e', background: 'rgba(244,63,94,0.06)', padding: '8px 14px', borderRadius: 8 }}>
                                        <strong>Rejection reason:</strong> {item.rejectionComment}
                                    </div>
                                )}

                                {/* Actions */}
                                {item.status === 'in-review' && (
                                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                        {isRejecting ? (
                                            <div>
                                                <textarea placeholder="Explain why this is being rejected..."
                                                    value={rejectComment} onChange={e => setRejectComment(e.target.value)}
                                                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(244,63,94,0.2)', color: '#f8fafc', outline: 'none', fontSize: 13, resize: 'vertical', minHeight: 60, boxSizing: 'border-box' }}
                                                    autoFocus />
                                                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                                    <button onClick={() => handleReject(item)} disabled={processingId === item.id}
                                                        style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#f43f5e', color: '#fff', border: 'none' }}>
                                                        {processingId === item.id ? 'Rejecting…' : '❌ Confirm Rejection'}
                                                    </button>
                                                    <button onClick={() => { setRejectingId(null); setRejectComment(''); }}
                                                        style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button onClick={() => handleApprove(item)} disabled={processingId === item.id}
                                                    style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#10b981', color: '#fff', border: 'none' }}>
                                                    {processingId === item.id ? 'Processing…' : '✅ Approve'}
                                                </button>
                                                <button onClick={() => { setRejectingId(item.id); setRejectComment(''); }} disabled={processingId === item.id}
                                                    style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(244,63,94,0.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)' }}>
                                                    ❌ Reject
                                                </button>
                                                <button onClick={() => navigate(`/vendors/${item.vendorId}`)}
                                                    style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)', marginLeft: 'auto' }}>
                                                    View Vendor →
                                                </button>
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
