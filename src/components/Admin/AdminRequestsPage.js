import React, { useState, useEffect, useContext } from 'react';
import { db } from '../../firebase';
import { collectionGroup, query, where, getDocs, doc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import useAdminNotificationSync from '../../hooks/useAdminNotificationSync'; // Only if needed explicitly, else handled in App.js
import './AdminRequestsPage.css'; // Optional styling

export default function AdminRequestsPage() {
    const { isSuperAdmin, userId, displayName } = useContext(UserContext);
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);

    // activeRequest is the one currently opened for approval/rejection
    const [activeRequest, setActiveRequest] = useState(null);
    const [rejectionNote, setRejectionNote] = useState('');
    const [correctionNote, setCorrectionNote] = useState('');

    useEffect(() => {
        if (!isSuperAdmin) {
            setLoading(false);
            return;
        }
        fetchRequests();
    }, [isSuperAdmin]);

    const fetchRequests = async () => {
        setLoading(true);
        try {
            // Fetch vendors to get vendor names
            const vendorsSnapshot = await getDocs(collection(db, 'vendors'));
            const vendorMap = {};
            vendorsSnapshot.forEach(vdoc => {
                vendorMap[vdoc.id] = vdoc.data().businessName || vdoc.data().name || 'Unknown Vendor';
            });

            // Using collectionGroup to get all items across vendors that are in-review
            const itemsGroupRef = collectionGroup(db, 'items');
            const q = query(itemsGroupRef, where('status', '==', 'in-review'));
            const snapshot = await getDocs(q);

            let reqs = snapshot.docs.map(doc => {
                const data = doc.data();
                // We need to parse vendorId from the path: vendors/VENDOR_ID/items/ITEM_ID
                const pathParts = doc.ref.path.split('/');
                const vId = pathParts.length > 2 ? pathParts[1] : 'unknown';
                return {
                    id: doc.id,
                    vendorId: vId,
                    vendorName: vendorMap[vId] || `${vId.slice(0, 8)}...`,
                    ...data
                };
            });

            // Fallback sort by requestedAt locally, since a composite index is likely missing
            reqs.sort((a, b) => {
                const timeA = a.requestedAt?.toMillis?.() || a.requestedAt?.seconds * 1000 || 0;
                const timeB = b.requestedAt?.toMillis?.() || b.requestedAt?.seconds * 1000 || 0;
                return timeB - timeA; // Descending (newest first)
            });

            setRequests(reqs);
        } catch (error) {
            console.error("Error fetching requests:", error);
            if (error.code === 'failed-precondition') {
                toast.error("Firebase Composite Index required for querying in-review items.");
            } else {
                toast.error("Failed to load requests.");
            }
        } finally {
            setLoading(false);
        }
    };

    const getRequestCategory = (req) => {
        if (req.changeType === 'add') return 'New Item Request';
        if (req.changeType === 'deactivate') return 'Item Deactivation';

        // It's an edit, determine what changed
        let changes = [];
        const old = req.originalData || {};
        const prop = req.proposedData || {};

        if (old.vendorPrice !== prop.vendorPrice) changes.push('Price');
        if (old.unit !== prop.unit || old.packQuantity !== prop.packQuantity || old.itemSize !== prop.itemSize) changes.push('Packaging/Unit');
        if (old.brand !== prop.brand) changes.push('Brand');
        if (old.category !== prop.category) changes.push('Category');

        if (changes.length > 0) return `Update: ${changes.join(', ')}`;
        return 'General Details Update';
    };

    const handleAction = async (actionType) => {
        if (!activeRequest) return;
        const reqRef = doc(db, `vendors/${activeRequest.vendorId}/items`, activeRequest.id);

        try {
            let notifTitle = '';
            let notifMessage = '';
            const itemName = activeRequest.proposedData?.name || activeRequest.name;

            if (actionType === 'approve') {
                const payload = activeRequest.changeType === 'deactivate'
                    ? { status: 'inactive' }
                    : { status: 'active', ...activeRequest.proposedData };

                await updateDoc(reqRef, {
                    ...payload,
                    rejectionComment: '',
                    updatedAt: new Date().toISOString()
                });

                notifTitle = 'Request Approved';
                notifMessage = `Your request for "${itemName}" has been approved.`;
                toast.success('Request approved.');
            } else if (actionType === 'reject') {
                if (!rejectionNote.trim()) { toast.warn('A rejection note is required'); return; }
                await updateDoc(reqRef, {
                    status: 'rejected',
                    rejectionComment: rejectionNote
                });

                notifTitle = 'Request Rejected';
                notifMessage = `Your request for "${itemName}" was rejected: ${rejectionNote}`;
                toast.success('Request rejected.');
            } else if (actionType === 'correction') {
                if (!correctionNote.trim()) { toast.warn('Correction note is required'); return; }
                await updateDoc(reqRef, {
                    status: 'needs-correction',
                    rejectionComment: correctionNote
                });

                notifTitle = 'Correction Needed';
                notifMessage = `Your request for "${itemName}" needs correction: ${correctionNote}`;
                toast.success('Sent back for correction.');
            }

            // Create Notification for the Vendor
            await addDoc(collection(db, 'notifications'), {
                type: 'admin_to_vendor',
                entityId: activeRequest.vendorId, // Vendor ID is the entity receiving this
                title: notifTitle,
                message: notifMessage,
                isRead: false,
                createdAt: serverTimestamp(),
                // Attach item info for deep linking later if needed
                metadata: { itemId: activeRequest.id, action: actionType }
            });

            // Refresh the list and close modal
            setActiveRequest(null);
            setRejectionNote('');
            setCorrectionNote('');
            fetchRequests();
        } catch (err) {
            console.error("Error processing request:", err);
            toast.error("Failed to process request");
        }
    };

    const formatDate = (ts) => {
        if (!ts) return 'Unknown';
        const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    if (!isSuperAdmin) {
        return <div className="page-header"><div><h1>Access Denied</h1></div></div>;
    }

    return (
        <div style={{ padding: '0 24px' }}>
            <div className="page-header" style={{ marginBottom: 24 }}>
                <div>
                    <h1>Vendor Requests</h1>
                    <p className="subtitle" style={{ margin: 0 }}>Review items submitted for approval or correction</p>
                </div>
                <button className="ui-btn ghost" onClick={fetchRequests} disabled={loading}>
                    ↻ Refresh
                </button>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading requests...</div>
            ) : requests.length === 0 ? (
                <div className="ui-card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>🎉</div>
                    No pending requests at this time.
                </div>
            ) : (
                <div className="ui-table-wrap">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Submitted</th>
                                <th>Vendor</th>
                                <th>Item</th>
                                <th>Request Type</th>
                                <th>Requested By</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.map(req => (
                                <tr key={req.id}>
                                    <td data-label="Submitted">
                                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatDate(req.requestedAt)}</div>
                                    </td>
                                    <td data-label="Vendor">
                                        <span className="badge blue" style={{ background: 'rgba(0,180,255,0.1)', color: '#4dabf7' }}>
                                            {req.vendorName}
                                        </span>
                                    </td>
                                    <td data-label="Item" style={{ fontWeight: 500 }}>
                                        {req.proposedData?.name || req.name}
                                    </td>
                                    <td data-label="Request Type">
                                        <div style={{ fontWeight: 500 }}>{getRequestCategory(req)}</div>
                                        {(req.proofUrls?.length > 0 || req.proofUrl) && <span style={{ fontSize: 11, color: '#4ade80' }}>📎 Proof Attached</span>}
                                    </td>
                                    <td data-label="Requested By">
                                        {req.requestedByName || 'Unknown'}
                                    </td>
                                    <td data-label="Actions">
                                        <button className="ui-btn small primary" onClick={() => setActiveRequest(req)}>
                                            Review Request
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Review Modal */}
            {activeRequest && (
                <div className="modalBackdrop" onClick={() => setActiveRequest(null)} style={{ zIndex: 9999 }}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
                        <div className="modalHeader" style={{ padding: '20px 24px', position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 10, borderBottom: '1px solid var(--border)' }}>
                            <h3 style={{ margin: 0 }}>Review Request: {activeRequest.proposedData?.name || activeRequest.name}</h3>
                            <button className="modal-close" onClick={() => setActiveRequest(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 22, cursor: 'pointer' }}>✕</button>
                        </div>
                        <div className="modalBody" style={{ padding: 24 }}>
                            {/* Request Details */}
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Request Category</div>
                                <div style={{ fontWeight: 600, fontSize: 16 }}>{getRequestCategory(activeRequest)}</div>
                            </div>

                            {/* Diff Viewer */}
                            {activeRequest.changeType === 'deactivate' ? (
                                <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8, color: '#ef4444' }}>
                                    Vendor has requested to <strong>Deactivate</strong> this item.
                                </div>
                            ) : activeRequest.changeType === 'add' ? (
                                <div style={{ padding: 16, background: 'rgba(0, 200, 255, 0.05)', border: '1px solid rgba(0, 200, 255, 0.2)', borderRadius: 8 }}>
                                    <strong style={{ color: '#4dabf7' }}>New Item Submission</strong>
                                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                                        {Object.entries(activeRequest.proposedData || {})
                                            .filter(([k]) => !['commissionPercent', 'imageUrl', 'createdAt', 'updatedAt', 'proofUrl', 'status', 'id'].includes(k))
                                            .map(([k, v]) => (
                                                <div key={k}><strong>{k}</strong>: {String(v)}</div>
                                            ))}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8 }}>
                                    <strong style={{ color: 'var(--text-primary)' }}>Proposed Changes</strong>
                                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                                        {Object.keys(activeRequest.proposedData || {}).map(key => {
                                            if (['commissionPercent', 'imageUrl', 'createdAt', 'updatedAt', 'proofUrl', 'status', 'id'].includes(key)) return null;
                                            const oldVal = activeRequest.originalData?.[key];
                                            const newVal = activeRequest.proposedData[key];
                                            if (String(oldVal) === String(newVal)) return null; // No change

                                            // Provide safer rendering of oldVal incase of null
                                            const displayOld = oldVal === undefined || oldVal === null ? '(empty)' : String(oldVal);
                                            const displayNew = String(newVal);

                                            return (
                                                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                    <div style={{ width: 120, fontWeight: 600, color: 'var(--muted)' }}>{key}</div>
                                                    <div style={{ textDecoration: 'line-through', color: '#ff6b7a', flex: 1 }}>{displayOld}</div>
                                                    <div style={{ color: '#4ade80', flex: 1 }}>➔ {displayNew}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Render image if proposed or existing */}
                            {(activeRequest.proposedData?.imageUrl || activeRequest.imageUrl) && (
                                <div style={{ marginTop: 20, padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8 }}>
                                    <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>📷 Item Image</div>
                                    <img src={activeRequest.proposedData?.imageUrl || activeRequest.imageUrl} alt="Item Preview" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, objectFit: 'cover' }} />
                                </div>
                            )}

                            {(activeRequest.proofUrls?.length > 0 || activeRequest.proofUrl) && (
                                <div style={{ marginTop: 20, padding: 16, background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 8 }}>
                                    <div style={{ fontWeight: 600, marginBottom: 8, color: '#4ade80' }}>📎 Supporting Documents</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {activeRequest.proofUrls && activeRequest.proofUrls.length > 0 ? (
                                            activeRequest.proofUrls.map((p, i) => (
                                                <a key={i} href={p.url} target="_blank" rel="noreferrer" className="ui-btn small ghost">
                                                    📄 {p.name || `View Document ${i + 1}`}
                                                </a>
                                            ))
                                        ) : activeRequest.proofUrl ? (
                                            <a href={activeRequest.proofUrl} target="_blank" rel="noreferrer" className="ui-btn small ghost">
                                                📄 View Attached Document
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                            )}

                            <div style={{ marginTop: 24 }}>
                                <label className="ui-label">Review Notes (Sent to Vendor on Reject/Correction)</label>
                                <input className="ui-input" placeholder="Feedback for the vendor..." value={rejectionNote || correctionNote} onChange={e => {
                                    setRejectionNote(e.target.value);
                                    setCorrectionNote(e.target.value);
                                }} />
                            </div>

                            <div style={{ marginTop: 20, display: 'flex', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                                <button className="ui-btn primary" onClick={() => handleAction('approve')}>
                                    ✓ Approve
                                </button>
                                <button className="ui-btn ghost" onClick={() => handleAction('correction')} style={{ color: '#f59e0b', border: '1px solid rgba(245,158,11,0.5)' }}>
                                    ↩ Send Back for Correction
                                </button>
                                <button className="ui-btn ghost" onClick={() => handleAction('reject')} style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.5)' }}>
                                    ✕ Reject
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
