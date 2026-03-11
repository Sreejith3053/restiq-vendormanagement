import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';

export default function DispatchDetailPage() {
    const { dispatchId } = useParams();
    const navigate = useNavigate();
    const { vendorId, isSuperAdmin } = useContext(UserContext);

    const [dispatch, setDispatch] = useState(null);
    const [loading, setLoading] = useState(true);

    const [notes, setNotes] = useState('');

    // Modals state
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectReason, setRejectReason] = useState('');

    const [showPartialModal, setShowPartialModal] = useState(false);
    const [partialItems, setPartialItems] = useState([]);
    const [partialReason, setPartialReason] = useState('');

    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchDispatch = async () => {
            try {
                const docRef = doc(db, 'vendorDispatches', dispatchId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (!isSuperAdmin && data.vendorId !== vendorId) {
                        toast.error('Unauthorized access');
                        navigate('/dispatch-requests');
                        return;
                    }
                    setDispatch({ id: docSnap.id, ...data });
                    setNotes(data.confirmationNotes || '');
                } else {
                    toast.error('Dispatch request not found');
                    navigate('/dispatch-requests');
                }
            } catch (err) {
                console.error("Error fetching dispatch details:", err);
                toast.error("Failed to load details");
            } finally {
                setLoading(false);
            }
        };

        fetchDispatch();
    }, [dispatchId, isSuperAdmin, vendorId, navigate]);

    const formatDate = (timestamp) => {
        if (!timestamp) return '';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
    };

    const handleConfirm = async () => {
        setSaving(true);
        try {
            const docRef = doc(db, 'vendorDispatches', dispatchId);
            await updateDoc(docRef, {
                status: 'Confirmed',
                confirmedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                confirmationNotes: notes
            });
            setDispatch(prev => ({ ...prev, status: 'Confirmed', confirmationNotes: notes }));
            toast.success('Dispatch Request Confirmed!');
        } catch (err) {
            console.error('Error confirming:', err);
            toast.error('Failed to confirm dispatch');
        } finally {
            setSaving(false);
        }
    };

    const handleMarkDelivered = async (day) => {
        setSaving(true);
        try {
            const docRef = doc(db, 'vendorDispatches', dispatchId);
            const updates = {};
            if (day === 'Monday') {
                updates.mondayDelivered = true;
                updates.mondayDeliveredAt = serverTimestamp();
            } else {
                updates.thursdayDelivered = true;
                updates.thursdayDeliveredAt = serverTimestamp();
            }

            const newMonStatus = day === 'Monday' ? true : dispatch.mondayDelivered;
            const newThuStatus = day === 'Thursday' ? true : dispatch.thursdayDelivered;

            const hasMondayItems = (dispatch.items || []).some(i => i.mondayQty > 0);
            const hasThursdayItems = (dispatch.items || []).some(i => i.thursdayQty > 0);

            let allDelivered = true;
            if (hasMondayItems && !newMonStatus) allDelivered = false;
            if (hasThursdayItems && !newThuStatus) allDelivered = false;

            if (allDelivered) {
                updates.status = 'Delivered';
                updates.deliveredAt = serverTimestamp();
            }

            updates.updatedAt = serverTimestamp();

            await updateDoc(docRef, updates);
            setDispatch(prev => ({
                ...prev,
                ...updates,
                status: allDelivered ? 'Delivered' : prev.status
            }));
            toast.success(`${day} delivery marked as done!`);
        } catch (err) {
            console.error('Error marking delivered:', err);
            toast.error('Failed to update status');
        } finally {
            setSaving(false);
        }
    };

    const submitReject = async () => {
        if (!rejectReason.trim()) {
            toast.warn('Rejection reason is required.');
            return;
        }
        setSaving(true);
        try {
            const docRef = doc(db, 'vendorDispatches', dispatchId);
            await updateDoc(docRef, {
                status: 'Rejected',
                updatedAt: serverTimestamp(),
                rejectionReason: rejectReason,
                confirmationNotes: notes
            });
            setDispatch(prev => ({ ...prev, status: 'Rejected', rejectionReason: rejectReason, confirmationNotes: notes }));
            setShowRejectModal(false);
            toast.success('Dispatch Request Rejected');
        } catch (err) {
            console.error('Error rejecting:', err);
            toast.error('Failed to reject dispatch');
        } finally {
            setSaving(false);
        }
    };

    const openPartialModal = () => {
        const itemsCopy = dispatch.items.map(i => ({
            ...i,
            confirmedMondayQty: i.confirmedMondayQty !== undefined ? i.confirmedMondayQty : (i.mondayQty || 0),
            confirmedThursdayQty: i.confirmedThursdayQty !== undefined ? i.confirmedThursdayQty : (i.thursdayQty || 0),
            status: i.status || 'available',
            note: i.note || ''
        }));
        setPartialItems(itemsCopy);
        setPartialReason(dispatch.partialReason || '');
        setShowPartialModal(true);
    };

    const submitPartial = async () => {
        if (!partialReason.trim()) {
            toast.warn('Please provide a reason for the partial confirmation.');
            return;
        }
        setSaving(true);
        try {
            const docRef = doc(db, 'vendorDispatches', dispatchId);
            await updateDoc(docRef, {
                status: 'Partially Confirmed',
                confirmedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                partialReason: partialReason,
                confirmationNotes: notes,
                items: partialItems
            });
            setDispatch(prev => ({
                ...prev,
                status: 'Partially Confirmed',
                partialReason: partialReason,
                confirmationNotes: notes,
                items: partialItems
            }));
            setShowPartialModal(false);
            toast.success('Partially Confirmed Successfully');
        } catch (err) {
            console.error('Error partially confirming:', err);
            toast.error('Failed to partially confirm');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#9db2ce' }}>Loading Dispatch Details...</div>;
    if (!dispatch) return null;

    let statusBg = 'rgba(255,255,255,0.1)';
    let statusColor = '#94a3b8';

    if (dispatch.status === 'Sent') {
        statusBg = 'rgba(56, 189, 248, 0.15)';
        statusColor = '#38bdf8';
    } else if (dispatch.status === 'Confirmed' || dispatch.status === 'Delivered') {
        statusBg = 'rgba(16, 185, 129, 0.15)';
        statusColor = '#10b981';
    } else if (dispatch.status === 'Partially Confirmed') {
        statusBg = 'rgba(245, 158, 11, 0.15)';
        statusColor = '#f59e0b';
    } else if (dispatch.status === 'Rejected') {
        statusBg = 'rgba(244, 63, 94, 0.15)';
        statusColor = '#f43f5e';
    }

    const { status } = dispatch;
    const canActionConfirm = status === 'Sent';
    const canActionDeliver = status === 'Confirmed' || status === 'Partially Confirmed' || status === 'Delivered';

    const hasMondayItems = (dispatch.items || []).some(i => i.mondayQty > 0);
    const hasThursdayItems = (dispatch.items || []).some(i => i.thursdayQty > 0);

    const isMondayDelivered = dispatch.mondayDelivered || (status === 'Delivered');
    const isThursdayDelivered = dispatch.thursdayDelivered || (status === 'Delivered');

    const canActionMonDeliver = canActionDeliver && hasMondayItems && !isMondayDelivered;
    const canActionThuDeliver = canActionDeliver && hasThursdayItems && !isThursdayDelivered;

    const renderTable = (isMonday) => {
        const items = dispatch.items || [];
        const hasItemsForDay = items.some(i => isMonday ? i.mondayQty > 0 : i.thursdayQty > 0);

        if (!hasItemsForDay) {
            return <div style={{ color: '#64748b', fontSize: 14, padding: '16px 0' }}>No items requested for {isMonday ? 'Monday' : 'Thursday'}</div>;
        }

        return (
            <table className="ui-table" style={{ width: '100%', marginBottom: 32 }}>
                <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                        <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'left' }}>Item</th>
                        <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'left' }}>Pack Label</th>
                        <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'right' }}>Requested Qty</th>
                        {(status === 'Partially Confirmed') && <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'right' }}>Confirmed Qty</th>}
                        {(status === 'Partially Confirmed') && <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'left' }}>Item Note</th>}
                    </tr>
                </thead>
                <tbody>
                    {items.filter(i => isMonday ? (i.mondayQty > 0 || i.confirmedMondayQty !== undefined) : (i.thursdayQty > 0 || i.confirmedThursdayQty !== undefined)).map((item, idx) => {
                        const requested = isMonday ? item.mondayQty : item.thursdayQty;
                        const confirmed = isMonday ? item.confirmedMondayQty : item.confirmedThursdayQty;

                        return (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <td style={{ padding: '12px 16px', fontWeight: 500 }}>{item.itemName}</td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13 }}>{item.packLabel}</td>
                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>{requested || 0}</td>
                                {(status === 'Partially Confirmed') && (
                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: (confirmed !== undefined && confirmed < requested) ? '#f59e0b' : '#10b981' }}>
                                        {item.status === 'unavailable' ? 'Unavailable' : (confirmed !== undefined ? confirmed : requested)}
                                    </td>
                                )}
                                {(status === 'Partially Confirmed') && (
                                    <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>{item.note || '-'}</td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    };

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto', color: '#f8fafc' }}>
            <div style={{ cursor: 'pointer', color: '#9db2ce', fontSize: 14, marginBottom: 16, display: 'inline-block' }} onClick={() => navigate('/dispatch-requests')}>
                &larr; Back to Dispatch Requests
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>Dispatch Details</h1>
                    <div style={{ color: '#94a3b8', fontSize: 14, display: 'flex', gap: 16 }}>
                        <span><strong style={{ color: '#e2e8f0' }}>ID:</strong> {dispatch.dispatchId || dispatch.id}</span>
                        <span><strong style={{ color: '#e2e8f0' }}>Week:</strong> {formatDate(dispatch.weekStart)} - {formatDate(dispatch.weekEnd)}</span>
                        <span><strong style={{ color: '#e2e8f0' }}>Restaurant:</strong> {dispatch.restaurantName}</span>
                    </div>
                </div>
                <div style={{ background: statusBg, color: statusColor, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {dispatch.status}
                </div>
            </div>

            {/* Financial Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
                    <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Restaurant Billing</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{formatCurrency(dispatch.restaurantBilling)}</div>
                </div>
                <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 12, padding: 20 }}>
                    <div style={{ color: '#10b981', fontSize: 12, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Vendor Payout</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{formatCurrency(dispatch.vendorPayout)}</div>
                </div>
                <div style={{ background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: 12, padding: 20 }}>
                    <div style={{ color: '#38bdf8', fontSize: 12, textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Marketplace Commission</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#38bdf8' }}>{formatCurrency(dispatch.marketplaceCommission)}</div>
                </div>
            </div>

            {/* Reasons if any */}
            {dispatch.rejectionReason && (
                <div style={{ background: 'rgba(244, 63, 94, 0.1)', padding: 16, borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #f43f5e' }}>
                    <strong style={{ color: '#f43f5e', fontSize: 13, textTransform: 'uppercase' }}>Rejection Reason</strong>
                    <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 14 }}>{dispatch.rejectionReason}</div>
                </div>
            )}
            {dispatch.partialReason && (
                <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 16, borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #f59e0b' }}>
                    <strong style={{ color: '#f59e0b', fontSize: 13, textTransform: 'uppercase' }}>Partial Confirmation Reason</strong>
                    <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 14 }}>{dispatch.partialReason}</div>
                </div>
            )}

            {/* Breakdowns */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 24, marginBottom: 32 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    Monday Route Breakdown
                    {isMondayDelivered && <span style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '2px 8px', borderRadius: 12, textTransform: 'uppercase' }}>✓ Delivered</span>}
                </h3>
                {renderTable(true)}

                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#e2e8f0', marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    Thursday Route Breakdown
                    {isThursdayDelivered && <span style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '2px 8px', borderRadius: 12, textTransform: 'uppercase' }}>✓ Delivered</span>}
                </h3>
                {renderTable(false)}
            </div>

            {/* Notes Section */}
            <div style={{ marginBottom: 32 }}>
                <label style={{ display: 'block', marginBottom: 8, color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Vendor Notes (Optional)</label>
                <textarea
                    className="ui-input"
                    disabled={!canActionConfirm}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{ width: '100%', minHeight: 100, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: 12, borderRadius: 8 }}
                    placeholder="Add any notes regarding this dispatch..."
                />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 24 }}>
                {canActionConfirm && (
                    <>
                        <button className="ui-btn ghost" onClick={() => setShowRejectModal(true)} disabled={saving} style={{ color: '#f43f5e', borderColor: 'transparent' }}>
                            Reject Dispatch
                        </button>
                        <button className="ui-btn ghost" onClick={openPartialModal} disabled={saving} style={{ color: '#f59e0b', borderColor: '#f59e0b' }}>
                            Partially Confirm
                        </button>
                        <button className="ui-btn primary" onClick={handleConfirm} disabled={saving} style={{ background: '#10b981', color: '#fff', border: 'none' }}>
                            {saving ? 'Saving...' : 'Confirm Dispatch'}
                        </button>
                    </>
                )}
                {canActionMonDeliver && (
                    <button className="ui-btn primary" onClick={() => handleMarkDelivered('Monday')} disabled={saving} style={{ background: '#3b82f6', color: '#fff', border: 'none' }}>
                        {saving ? 'Saving...' : 'Mark Monday Delivered'}
                    </button>
                )}
                {canActionThuDeliver && (
                    <button className="ui-btn primary" onClick={() => handleMarkDelivered('Thursday')} disabled={saving} style={{ background: '#3b82f6', color: '#fff', border: 'none' }}>
                        {saving ? 'Saving...' : 'Mark Thursday Delivered'}
                    </button>
                )}
            </div>

            {/* ================= MODALS ================= */}

            {/* Reject Modal */}
            {showRejectModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#1e293b', padding: 24, borderRadius: 12, width: 400, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
                        <h2 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 600 }}>Reject Dispatch</h2>
                        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>Please provide a reason for rejecting this week's dispatch. This will alert the Global Supply Control Tower immediately.</p>

                        <textarea
                            className="ui-input"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            style={{ width: '100%', minHeight: 100, marginBottom: 24, padding: 12, borderRadius: 8, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)' }}
                            placeholder="Reason for rejection..."
                            autoFocus
                        />

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button className="ui-btn ghost" onClick={() => setShowRejectModal(false)} disabled={saving}>Cancel</button>
                            <button className="ui-btn" onClick={submitReject} disabled={saving} style={{ background: '#f43f5e', color: '#fff', border: 'none' }}>
                                {saving ? 'Submitting...' : 'Confirm Reject'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Partial Modal */}
            {showPartialModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <div style={{ background: '#1e293b', padding: 24, borderRadius: 12, width: '100%', maxWidth: 800, maxHeight: '90vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
                        <h2 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 600 }}>Partially Confirm Dispatch</h2>
                        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24 }}>Adjust quantities or mark items as unavailable. A reason must be provided for the partial confirmation.</p>

                        <div style={{ marginBottom: 24 }}>
                            <label style={{ display: 'block', marginBottom: 8, color: '#e2e8f0', fontSize: 14, fontWeight: 500 }}>Overall Reason <span style={{ color: '#f43f5e' }}>*</span></label>
                            <input
                                className="ui-input"
                                value={partialReason}
                                onChange={(e) => setPartialReason(e.target.value)}
                                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)' }}
                                placeholder="e.g. Tomato shortage, reducing Monday qty..."
                            />
                        </div>

                        <div style={{ overflowX: 'auto', marginBottom: 32 }}>
                            <table className="ui-table" style={{ width: '100%' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Item</th>
                                        <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Available</th>
                                        <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Mon Diff</th>
                                        <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Thu Diff</th>
                                        <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {partialItems.map((item, idx) => (
                                        <tr key={idx}>
                                            <td style={{ fontWeight: 500 }}>
                                                <div>{item.itemName}</div>
                                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.packLabel}</div>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={item.status !== 'unavailable'}
                                                    onChange={(e) => {
                                                        const copy = [...partialItems];
                                                        copy[idx].status = e.target.checked ? 'available' : 'unavailable';
                                                        if (!e.target.checked) {
                                                            copy[idx].confirmedMondayQty = 0;
                                                            copy[idx].confirmedThursdayQty = 0;
                                                        } else {
                                                            copy[idx].confirmedMondayQty = item.mondayQty || 0;
                                                            copy[idx].confirmedThursdayQty = item.thursdayQty || 0;
                                                        }
                                                        setPartialItems(copy);
                                                    }}
                                                    style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{item.mondayQty || 0} →</span>
                                                    <input
                                                        type="number"
                                                        className="ui-input"
                                                        style={{ width: 60, padding: 6, textAlign: 'center', background: 'rgba(0,0,0,0.5)' }}
                                                        min="0"
                                                        max={item.mondayQty || 0}
                                                        value={item.confirmedMondayQty}
                                                        disabled={item.status === 'unavailable'}
                                                        onChange={(e) => {
                                                            const copy = [...partialItems];
                                                            copy[idx].confirmedMondayQty = parseInt(e.target.value) || 0;
                                                            setPartialItems(copy);
                                                        }}
                                                    />
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{item.thursdayQty || 0} →</span>
                                                    <input
                                                        type="number"
                                                        className="ui-input"
                                                        style={{ width: 60, padding: 6, textAlign: 'center', background: 'rgba(0,0,0,0.5)' }}
                                                        min="0"
                                                        max={item.thursdayQty || 0}
                                                        value={item.confirmedThursdayQty}
                                                        disabled={item.status === 'unavailable'}
                                                        onChange={(e) => {
                                                            const copy = [...partialItems];
                                                            copy[idx].confirmedThursdayQty = parseInt(e.target.value) || 0;
                                                            setPartialItems(copy);
                                                        }}
                                                    />
                                                </div>
                                            </td>
                                            <td>
                                                <input
                                                    className="ui-input"
                                                    style={{ width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.5)' }}
                                                    placeholder="Item note..."
                                                    value={item.note || ''}
                                                    onChange={(e) => {
                                                        const copy = [...partialItems];
                                                        copy[idx].note = e.target.value;
                                                        setPartialItems(copy);
                                                    }}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button className="ui-btn ghost" onClick={() => setShowPartialModal(false)} disabled={saving}>Cancel</button>
                            <button className="ui-btn" onClick={submitPartial} disabled={saving} style={{ background: '#f59e0b', color: '#fff', border: 'none' }}>
                                {saving ? 'Submitting...' : 'Submit Partial Confirmation'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
