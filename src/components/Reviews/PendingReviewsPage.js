// src/components/Reviews/PendingReviewsPage.js
import React, { useEffect, useState, useContext } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import './PendingReviews.css';

export default function PendingReviewsPage() {
    const { isSuperAdmin, userId, displayName } = useContext(UserContext);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState(null);
    const [filter, setFilter] = useState('pending');
    const [rejectingId, setRejectingId] = useState(null);
    const [rejectComment, setRejectComment] = useState('');

    useEffect(() => {
        loadReviews();
    }, []);

    const loadReviews = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'pendingReviews'));
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort by requestedAt descending
            data.sort((a, b) => {
                const tA = a.requestedAt?.toMillis?.() || a.requestedAt?.seconds * 1000 || 0;
                const tB = b.requestedAt?.toMillis?.() || b.requestedAt?.seconds * 1000 || 0;
                return tB - tA;
            });
            setReviews(data);
        } catch (err) {
            console.error('Error loading reviews:', err);
            toast.error('Failed to load pending reviews');
        } finally {
            setLoading(false);
        }
    };

    // Approve: apply changes to the item, then mark review as approved
    const handleApprove = async (review) => {
        setProcessingId(review.id);
        try {
            if (review.changeType === 'edit' && review.proposedData) {
                // Apply the edit to the item and set status to active
                const itemRef = doc(db, `vendors/${review.vendorId}/items`, review.itemId);
                await updateDoc(itemRef, {
                    ...review.proposedData,
                    status: 'active',
                    rejectionComment: '',
                    updatedAt: new Date().toISOString(),
                });
            } else if (review.changeType === 'delete') {
                // Delete the item
                await deleteDoc(doc(db, `vendors/${review.vendorId}/items`, review.itemId));
            }

            // Mark review as approved
            await updateDoc(doc(db, 'pendingReviews', review.id), {
                status: 'approved',
                reviewedBy: userId,
                reviewedByName: displayName,
                reviewedAt: serverTimestamp(),
            });

            setReviews(prev => prev.map(r =>
                r.id === review.id ? { ...r, status: 'approved' } : r
            ));
            toast.success(`✅ ${review.changeType === 'delete' ? 'Deletion' : 'Edit'} approved!`);
        } catch (err) {
            console.error('Error approving review:', err);
            toast.error('Failed to approve review');
        } finally {
            setProcessingId(null);
        }
    };

    // Reject: mark review as rejected with comments, update item status
    const handleReject = async (review) => {
        if (!rejectComment.trim()) {
            toast.warn('Please add a comment explaining the rejection.');
            return;
        }
        setProcessingId(review.id);
        try {
            // Mark review as rejected with comment
            await updateDoc(doc(db, 'pendingReviews', review.id), {
                status: 'rejected',
                rejectionComment: rejectComment.trim(),
                reviewedBy: userId,
                reviewedByName: displayName,
                reviewedAt: serverTimestamp(),
            });

            // Update item status to rejected with comment
            const itemRef = doc(db, `vendors/${review.vendorId}/items`, review.itemId);
            await updateDoc(itemRef, {
                status: 'rejected',
                rejectionComment: rejectComment.trim(),
            });

            setReviews(prev => prev.map(r =>
                r.id === review.id ? { ...r, status: 'rejected', rejectionComment: rejectComment.trim() } : r
            ));
            setRejectingId(null);
            setRejectComment('');
            toast.info('❌ Change request rejected.');
        } catch (err) {
            console.error('Error rejecting review:', err);
            toast.error('Failed to reject review');
        } finally {
            setProcessingId(null);
        }
    };

    const filteredReviews = reviews.filter(r => filter === 'all' || r.status === filter);

    const pendingCount = reviews.filter(r => r.status === 'pending').length;

    const formatDate = (ts) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading reviews...</div>;
    }

    return (
        <div className="pending-reviews-page">
            <div className="page-header">
                <h2>Pending Reviews {pendingCount > 0 && <span className="pending-count-badge">{pendingCount}</span>}</h2>
            </div>

            {/* Filter tabs */}
            <div className="review-filters">
                {['pending', 'approved', 'rejected', 'all'].map(f => (
                    <button
                        key={f}
                        className={`review-filter-btn ${filter === f ? 'active' : ''}`}
                        onClick={() => setFilter(f)}
                    >
                        {f === 'pending' && '🕐 '}
                        {f === 'approved' && '✅ '}
                        {f === 'rejected' && '❌ '}
                        {f === 'all' && '📋 '}
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                        {f === 'pending' && pendingCount > 0 && ` (${pendingCount})`}
                    </button>
                ))}
            </div>

            {filteredReviews.length === 0 ? (
                <div className="ui-card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                    {filter === 'pending' ? '🎉 No pending reviews!' : `No ${filter} reviews found.`}
                </div>
            ) : (
                <div className="reviews-list">
                    {filteredReviews.map(review => (
                        <div key={review.id} className={`review-card ${review.status}`}>
                            {/* Review Header */}
                            <div className="review-header">
                                <div className="review-meta">
                                    <span className={`review-type-badge ${review.changeType}`}>
                                        {review.changeType === 'edit' ? '✏️ Edit' : '🗑️ Delete'}
                                    </span>
                                    <span className={`review-status-badge ${review.status}`}>
                                        {review.status}
                                    </span>
                                </div>
                                <div className="review-info">
                                    <strong>{review.itemName || 'Unknown Item'}</strong>
                                    <span className="muted"> — {review.vendorName || 'Unknown Vendor'}</span>
                                </div>
                                <div className="review-requester">
                                    Requested by <strong>{review.requestedByName}</strong> on {formatDate(review.requestedAt)}
                                </div>
                            </div>

                            {/* Diff View */}
                            {review.changeType === 'edit' && review.originalData && review.proposedData && (
                                <div className="review-diff">
                                    <table className="diff-table">
                                        <thead>
                                            <tr>
                                                <th>Field</th>
                                                <th>Current</th>
                                                <th>Proposed</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.keys(review.proposedData).map(field => {
                                                const orig = String(review.originalData[field] ?? '');
                                                const proposed = String(review.proposedData[field] ?? '');
                                                const changed = orig !== proposed;
                                                if (!changed) return null;
                                                return (
                                                    <tr key={field} className="diff-row changed">
                                                        <td className="diff-field">{field}</td>
                                                        <td className="diff-old">{field === 'price' ? `$${Number(orig).toFixed(2)}` : orig || '—'}</td>
                                                        <td className="diff-new">{field === 'price' ? `$${Number(proposed).toFixed(2)}` : proposed || '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {review.changeType === 'delete' && review.originalData && (
                                <div className="review-diff delete-summary">
                                    <p>⚠️ This will permanently delete <strong>{review.originalData.name}</strong> ({review.originalData.category}, ${Number(review.originalData.price).toFixed(2)}/{review.originalData.unit})</p>
                                </div>
                            )}

                            {/* Actions */}
                            {review.status === 'pending' && (
                                <div className="review-actions">
                                    {rejectingId === review.id ? (
                                        /* Rejection comment mode */
                                        <div style={{ flex: 1 }}>
                                            <textarea
                                                className="ui-input"
                                                placeholder="Explain why this is being rejected..."
                                                value={rejectComment}
                                                onChange={e => setRejectComment(e.target.value)}
                                                style={{ height: 60, marginBottom: 10, fontSize: 13 }}
                                                autoFocus
                                            />
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button
                                                    className="ui-btn danger small"
                                                    onClick={() => handleReject(review)}
                                                    disabled={processingId === review.id}
                                                >
                                                    {processingId === review.id ? 'Rejecting…' : '❌ Confirm Rejection'}
                                                </button>
                                                <button
                                                    className="ui-btn ghost small"
                                                    onClick={() => { setRejectingId(null); setRejectComment(''); }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Normal action buttons */
                                        <>
                                            <button
                                                className="ui-btn primary small"
                                                onClick={() => handleApprove(review)}
                                                disabled={processingId === review.id}
                                            >
                                                {processingId === review.id ? 'Processing…' : '✅ Approve'}
                                            </button>
                                            <button
                                                className="ui-btn danger small"
                                                onClick={() => { setRejectingId(review.id); setRejectComment(''); }}
                                                disabled={processingId === review.id}
                                            >
                                                ❌ Reject
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Show rejection comment for already-rejected reviews */}
                            {review.status === 'rejected' && review.rejectionComment && (
                                <div style={{ marginTop: 12, fontSize: 13, color: '#ff6b7a', background: 'rgba(255,77,106,0.06)', padding: '8px 12px', borderRadius: 6 }}>
                                    <strong>Rejection reason:</strong> {review.rejectionComment}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
