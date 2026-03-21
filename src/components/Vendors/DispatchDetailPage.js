import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { logDispatchSent } from '../../utils/adminAuditLogger';
import { ops } from '../../services/operationsLogger';

// ── Status Configs ──────────────────────────────────────────────────────────
const STATUS_CONFIG = {
    'Sent':                  { bg: 'rgba(56, 189, 248, 0.15)',  color: '#38bdf8', icon: '📩', label: 'Sent' },
    'Vendor Reviewing':      { bg: 'rgba(168,85,247,0.15)',     color: '#a855f7', icon: '👁️', label: 'Reviewing' },
    'Confirmed':             { bg: 'rgba(16, 185, 129, 0.15)',  color: '#10b981', icon: '✅', label: 'Confirmed' },
    'Partially Confirmed':   { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', icon: '⚠️', label: 'Partial' },
    'Rejected':              { bg: 'rgba(244, 63, 94, 0.15)',   color: '#f43f5e', icon: '❌', label: 'Rejected' },
    'Packed':                { bg: 'rgba(99,102,241,0.15)',     color: '#6366f1', icon: '📦', label: 'Packed' },
    'Out for Delivery':      { bg: 'rgba(14,165,233,0.15)',     color: '#0ea5e9', icon: '🚚', label: 'In Transit' },
    'Delivered':             { bg: 'rgba(16, 185, 129, 0.15)',  color: '#10b981', icon: '✓',  label: 'Delivered' },
};

function getStatusStyle(status) {
    return STATUS_CONFIG[status] || { bg: 'rgba(255,255,255,0.1)', color: '#94a3b8', icon: '—', label: status || 'Unknown' };
}

// ── Workflow Progress ───────────────────────────────────────────────────────
const WORKFLOW_STEPS = ['Sent', 'Confirmed', 'Packed', 'Out for Delivery', 'Delivered'];

function WorkflowProgress({ currentStatus }) {
    const isRejected = currentStatus === 'Rejected';
    const isPartial = currentStatus === 'Partially Confirmed';
    const activeStatus = isPartial ? 'Confirmed' : currentStatus;
    const currentIdx = WORKFLOW_STEPS.indexOf(activeStatus);

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '16px 20px', position: 'relative', overflow: 'hidden' }}>
            {isRejected && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(244,63,94,0.04)' }} />
            )}
            {WORKFLOW_STEPS.map((step, i) => {
                const sc = getStatusStyle(step);
                const isActive = i <= currentIdx && !isRejected;
                const isCurrent = step === activeStatus && !isRejected;
                return (
                    <React.Fragment key={step}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative', zIndex: 1 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: '50%',
                                background: isActive ? `${sc.color}33` : 'rgba(255,255,255,0.05)',
                                border: isCurrent ? `2px solid ${sc.color}` : '2px solid rgba(255,255,255,0.08)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 14, transition: 'all 0.3s',
                                boxShadow: isCurrent ? `0 0 12px ${sc.color}44` : 'none',
                            }}>
                                {isActive ? sc.icon : <span style={{ color: '#475569', fontSize: 12 }}>{i + 1}</span>}
                            </div>
                            <span style={{ fontSize: 10, color: isActive ? sc.color : '#475569', marginTop: 6, fontWeight: isCurrent ? 700 : 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                {step}
                            </span>
                        </div>
                        {i < WORKFLOW_STEPS.length - 1 && (
                            <div style={{ flex: '0 0 auto', width: 40, height: 2, background: isActive && i < currentIdx ? sc.color : 'rgba(255,255,255,0.08)', transition: 'background 0.3s', marginTop: -16 }} />
                        )}
                    </React.Fragment>
                );
            })}
            {isRejected && (
                <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(244,63,94,0.15)', color: '#f43f5e', padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', zIndex: 2 }}>
                    ❌ REJECTED
                </div>
            )}
            {isPartial && (
                <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', zIndex: 2 }}>
                    ⚠️ PARTIAL
                </div>
            )}
        </div>
    );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function DispatchDetailPage() {
    const { dispatchId } = useParams();
    const navigate = useNavigate();
    const { vendorId, isSuperAdmin } = useContext(UserContext);

    const [dispatch, setDispatch] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notes, setNotes] = useState('');
    const [estimatedDelivery, setEstimatedDelivery] = useState('');

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
                // First try vendorDispatches
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
                    setEstimatedDelivery(data.estimatedDeliveryTime || '');
                } else {
                    // Fallback: try marketplaceOrders
                    const marketRef = doc(db, 'marketplaceOrders', dispatchId);
                    const marketSnap = await getDoc(marketRef);
                    if (marketSnap.exists()) {
                        const data = marketSnap.data();
                        if (!isSuperAdmin && data.vendorId !== vendorId) {
                            toast.error('Unauthorized access');
                            navigate('/dispatch-requests');
                            return;
                        }
                        // Map marketplace order status to dispatch status
                        let dispatchStatus = 'Sent';
                        const s = data.status || '';
                        if (s === 'pending_confirmation') dispatchStatus = 'Sent';
                        else if (s === 'pending_fulfillment' || s === 'pending_customer_approval') dispatchStatus = 'Confirmed';
                        else if (s === 'delivery_in_route') dispatchStatus = 'Out for Delivery';
                        else if (s === 'delivered_awaiting_confirmation' || s === 'fulfilled') dispatchStatus = 'Delivered';
                        else if (s === 'cancelled_by_vendor' || s === 'rejected' || s === 'cancelled_by_customer') dispatchStatus = 'Rejected';
                        else if (s === 'in_review') dispatchStatus = 'Vendor Reviewing';

                        // Normalize marketplace items to dispatch item shape
                        const items = (data.items || []).map(item => ({
                            itemName: item.name || item.itemName || 'Unknown Item',
                            packLabel: item.unit || item.packSize || '—',
                            mondayQty: item.qty || 0,
                            thursdayQty: 0,
                            confirmedMondayQty: item.qty || 0,
                            confirmedThursdayQty: 0,
                        }));

                        const total = data.grandTotalAfterTax || data.total || 0;

                        setDispatch({
                            id: marketSnap.id,
                            dispatchId: data.orderGroupId || marketSnap.id.slice(-8).toUpperCase(),
                            vendorId: data.vendorId,
                            vendorName: data.vendorName,
                            restaurantName: data.restaurantName || data.restaurantId || '—',
                            status: dispatchStatus,
                            weekStart: data.createdAt,
                            weekEnd: null,
                            sentAt: data.createdAt,
                            vendorPayout: total,
                            restaurantBilling: total,
                            marketplaceCommission: 0,
                            items,
                            _source: 'marketplace',
                            _marketplaceStatus: s,
                        });
                        setNotes('');
                        setEstimatedDelivery('');
                    } else {
                        toast.error('Order not found');
                        navigate('/dispatch-requests');
                    }
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

    // ── Action Handlers ─────────────────────────────────────────────────

    const updateStatus = async (newStatus, extras = {}) => {
        setSaving(true);
        try {
            const beforeStatus = dispatch.status;

            if (dispatch._source === 'marketplace') {
                // Map dispatch status back to marketplace status
                let marketplaceStatus = 'pending_confirmation';
                if (newStatus === 'Confirmed') marketplaceStatus = 'pending_fulfillment';
                else if (newStatus === 'Packed') marketplaceStatus = 'pending_fulfillment';
                else if (newStatus === 'Out for Delivery') marketplaceStatus = 'delivery_in_route';
                else if (newStatus === 'Delivered') marketplaceStatus = 'delivered_awaiting_confirmation';
                else if (newStatus === 'Rejected') marketplaceStatus = 'cancelled_by_vendor';

                const marketRef = doc(db, 'marketplaceOrders', dispatchId);
                await updateDoc(marketRef, {
                    status: marketplaceStatus,
                    updatedAt: serverTimestamp(),
                });
                setDispatch(prev => ({ ...prev, status: newStatus, _marketplaceStatus: marketplaceStatus }));
            } else {
                const docRef = doc(db, 'vendorDispatches', dispatchId);
                const updates = {
                    status: newStatus,
                    updatedAt: serverTimestamp(),
                    ...extras,
                };
                await updateDoc(docRef, updates);
                setDispatch(prev => ({ ...prev, ...updates, status: newStatus }));
            }

            // Audit logging
            ops.info('dispatch_status_change', { dispatchId, from: beforeStatus, to: newStatus });
            try { logDispatchSent({ dispatchId, vendorId: dispatch.vendorId, vendorName: dispatch.vendorName, weekStart: dispatch.weekStart }); } catch (_) {}

            toast.success(`Status updated to ${newStatus}`);
        } catch (err) {
            console.error(`Error updating to ${newStatus}:`, err);
            toast.error(`Failed to update status`);
        } finally {
            setSaving(false);
        }
    };

    const handleConfirm = () => updateStatus('Confirmed', {
        confirmedAt: serverTimestamp(),
        confirmationNotes: notes,
        estimatedDeliveryTime: estimatedDelivery || null,
    });

    const handleMarkPacked = () => updateStatus('Packed', { packedAt: serverTimestamp() });

    const handleMarkOutForDelivery = () => updateStatus('Out for Delivery', { outForDeliveryAt: serverTimestamp() });

    const handleMarkDelivered = async (day) => {
        setSaving(true);
        try {
            if (dispatch._source === 'marketplace') {
                // For marketplace orders, just mark as delivered
                const marketRef = doc(db, 'marketplaceOrders', dispatchId);
                await updateDoc(marketRef, {
                    status: 'delivered_awaiting_confirmation',
                    deliveredAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                setDispatch(prev => ({ ...prev, status: 'Delivered', _marketplaceStatus: 'delivered_awaiting_confirmation' }));
                toast.success('Delivery marked as done!');
            } else {
                const docRef = doc(db, 'vendorDispatches', dispatchId);
                const updates = { updatedAt: serverTimestamp() };
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

                await updateDoc(docRef, updates);
                setDispatch(prev => ({ ...prev, ...updates, status: allDelivered ? 'Delivered' : prev.status }));
                ops.info('dispatch_delivery_marked', { dispatchId, day, allDelivered });
                toast.success(`${day} delivery marked as done!`);
            }
        } catch (err) {
            console.error('Error marking delivered:', err);
            toast.error('Failed to update status');
        } finally {
            setSaving(false);
        }
    };

    const submitReject = async () => {
        if (!rejectReason.trim()) { toast.warn('Rejection reason is required.'); return; }
        await updateStatus('Rejected', {
            rejectionReason: rejectReason,
            confirmationNotes: notes,
        });
        setShowRejectModal(false);
    };

    const openPartialModal = () => {
        const itemsCopy = dispatch.items.map(i => ({
            ...i,
            confirmedMondayQty: i.confirmedMondayQty !== undefined ? i.confirmedMondayQty : (i.mondayQty || 0),
            confirmedThursdayQty: i.confirmedThursdayQty !== undefined ? i.confirmedThursdayQty : (i.thursdayQty || 0),
            unavailableMondayQty: i.unavailableMondayQty || 0,
            unavailableThursdayQty: i.unavailableThursdayQty || 0,
            status: i.status || 'available',
            note: i.note || '',
            substituteText: i.substituteText || '',
            vendorReason: i.vendorReason || '',
        }));
        setPartialItems(itemsCopy);
        setPartialReason(dispatch.partialReason || '');
        setShowPartialModal(true);
    };

    const submitPartial = async () => {
        if (!partialReason.trim()) { toast.warn('Please provide a reason for the partial confirmation.'); return; }
        setSaving(true);
        try {
            // Compute unavailable quantities
            const enrichedItems = partialItems.map(item => ({
                ...item,
                unavailableMondayQty: Math.max(0, (item.mondayQty || 0) - (item.confirmedMondayQty || 0)),
                unavailableThursdayQty: Math.max(0, (item.thursdayQty || 0) - (item.confirmedThursdayQty || 0)),
            }));

            const docRef = doc(db, 'vendorDispatches', dispatchId);
            await updateDoc(docRef, {
                status: 'Partially Confirmed',
                confirmedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                partialReason: partialReason,
                confirmationNotes: notes,
                estimatedDeliveryTime: estimatedDelivery || null,
                items: enrichedItems,
            });
            setDispatch(prev => ({
                ...prev,
                status: 'Partially Confirmed',
                partialReason: partialReason,
                confirmationNotes: notes,
                items: enrichedItems,
            }));
            setShowPartialModal(false);
            ops.info('dispatch_partially_confirmed', { dispatchId, itemCount: enrichedItems.length });
            toast.success('Partially Confirmed Successfully');
        } catch (err) {
            console.error('Error partially confirming:', err);
            toast.error('Failed to partially confirm');
        } finally {
            setSaving(false);
        }
    };

    // ── Loading / Guard ─────────────────────────────────────────────────
    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#9db2ce' }}>Loading Dispatch Details...</div>;
    if (!dispatch) return null;

    const st = getStatusStyle(dispatch.status);
    const { status } = dispatch;
    const canActionConfirm = status === 'Sent' || status === 'Vendor Reviewing';
    const canPack = status === 'Confirmed' || status === 'Partially Confirmed';
    const canOutForDelivery = status === 'Packed';
    const canDeliver = status === 'Out for Delivery' || status === 'Confirmed' || status === 'Partially Confirmed' || status === 'Packed';

    const hasMondayItems = (dispatch.items || []).some(i => i.mondayQty > 0);
    const hasThursdayItems = (dispatch.items || []).some(i => i.thursdayQty > 0);
    const isMondayDelivered = dispatch.mondayDelivered || (status === 'Delivered');
    const isThursdayDelivered = dispatch.thursdayDelivered || (status === 'Delivered');
    const canActionMonDeliver = canDeliver && hasMondayItems && !isMondayDelivered;
    const canActionThuDeliver = canDeliver && hasThursdayItems && !isThursdayDelivered;

    // ── Render Item Table ───────────────────────────────────────────────
    const renderTable = (isMonday) => {
        const items = dispatch.items || [];
        const hasItemsForDay = items.some(i => isMonday ? i.mondayQty > 0 : i.thursdayQty > 0);
        if (!hasItemsForDay) {
            return <div style={{ color: '#64748b', fontSize: 14, padding: '16px 0' }}>No items requested for {isMonday ? 'Monday' : 'Thursday'}</div>;
        }

        const showPartialCols = status === 'Partially Confirmed';

        return (
            <table className="ui-table" style={{ width: '100%', marginBottom: 32 }}>
                <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                        <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'left' }}>Item</th>
                        <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'left' }}>Pack Label</th>
                        <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'right' }}>Requested</th>
                        {showPartialCols && <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'right' }}>Confirmed</th>}
                        {showPartialCols && <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'right' }}>Unavail.</th>}
                        {showPartialCols && <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'left' }}>Substitute</th>}
                        {showPartialCols && <th style={{ color: '#94a3b8', padding: '12px 16px', textAlign: 'left' }}>Note</th>}
                    </tr>
                </thead>
                <tbody>
                    {items.filter(i => isMonday ? (i.mondayQty > 0 || i.confirmedMondayQty !== undefined) : (i.thursdayQty > 0 || i.confirmedThursdayQty !== undefined)).map((item, idx) => {
                        const requested = isMonday ? item.mondayQty : item.thursdayQty;
                        const confirmed = isMonday ? item.confirmedMondayQty : item.confirmedThursdayQty;
                        const unavailable = isMonday ? item.unavailableMondayQty : item.unavailableThursdayQty;

                        return (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <td style={{ padding: '12px 16px', fontWeight: 500 }}>{item.itemName}</td>
                                <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13 }}>{item.packLabel}</td>
                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>{requested || 0}</td>
                                {showPartialCols && (
                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: (confirmed !== undefined && confirmed < requested) ? '#f59e0b' : '#10b981' }}>
                                        {item.status === 'unavailable' ? '—' : (confirmed !== undefined ? confirmed : requested)}
                                    </td>
                                )}
                                {showPartialCols && (
                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: unavailable > 0 ? '#f43f5e' : '#475569' }}>
                                        {item.status === 'unavailable' ? 'All' : (unavailable || 0)}
                                    </td>
                                )}
                                {showPartialCols && (
                                    <td style={{ padding: '12px 16px', color: item.substituteText ? '#a78bfa' : '#475569', fontSize: 13, fontStyle: item.substituteText ? 'normal' : 'italic' }}>
                                        {item.substituteText || '—'}
                                    </td>
                                )}
                                {showPartialCols && (
                                    <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>{item.note || item.vendorReason || '—'}</td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        );
    };

    // ── RENDER ───────────────────────────────────────────────────────────

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto', color: '#f8fafc' }}>
            <div style={{ cursor: 'pointer', color: '#9db2ce', fontSize: 14, marginBottom: 16, display: 'inline-block' }} onClick={() => navigate('/dispatch-requests')}>
                &larr; Back to Dispatch Requests
            </div>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>Dispatch Details</h1>
                    <div style={{ color: '#94a3b8', fontSize: 14, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <span><strong style={{ color: '#e2e8f0' }}>ID:</strong> {dispatch.dispatchId || dispatch.id}</span>
                        <span><strong style={{ color: '#e2e8f0' }}>Week:</strong> {formatDate(dispatch.weekStart)} - {formatDate(dispatch.weekEnd)}</span>
                        <span><strong style={{ color: '#e2e8f0' }}>Restaurant:</strong> {dispatch.restaurantName}</span>
                    </div>
                </div>
                <div style={{ background: st.bg, color: st.color, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{st.icon}</span> {dispatch.status}
                </div>
            </div>

            {/* Workflow Progress */}
            <WorkflowProgress currentStatus={dispatch.status} />

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

            {/* Status Reasons */}
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

            {/* Estimated Delivery Display */}
            {dispatch.estimatedDeliveryTime && (
                <div style={{ background: 'rgba(99,102,241,0.08)', padding: 16, borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #6366f1' }}>
                    <strong style={{ color: '#6366f1', fontSize: 13, textTransform: 'uppercase' }}>Estimated Delivery</strong>
                    <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 14 }}>{dispatch.estimatedDeliveryTime}</div>
                </div>
            )}

            {/* Route Breakdowns */}
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

            {/* Notes + Estimated Delivery (editable when Sent) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
                <div>
                    <label style={{ display: 'block', marginBottom: 8, color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Vendor Notes</label>
                    <textarea
                        className="ui-input"
                        disabled={!canActionConfirm}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        style={{ width: '100%', minHeight: 80, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: 12, borderRadius: 8 }}
                        placeholder="Add any notes regarding this dispatch..."
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: 8, color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Estimated Delivery Time</label>
                    <input
                        className="ui-input"
                        disabled={!canActionConfirm}
                        value={estimatedDelivery}
                        onChange={(e) => setEstimatedDelivery(e.target.value)}
                        style={{ width: '100%', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: 12, borderRadius: 8 }}
                        placeholder="e.g. Monday 6:00 AM, Thursday 7:00 AM"
                    />
                </div>
            </div>

            {/* Actions Bar */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 24 }}>
                {canActionConfirm && (
                    <>
                        <button className="ui-btn ghost" onClick={() => setShowRejectModal(true)} disabled={saving} style={{ color: '#f43f5e', borderColor: 'transparent' }}>
                            ❌ Reject
                        </button>
                        <button className="ui-btn ghost" onClick={openPartialModal} disabled={saving} style={{ color: '#f59e0b', borderColor: '#f59e0b' }}>
                            ⚠️ Partially Confirm
                        </button>
                        <button className="ui-btn primary" onClick={handleConfirm} disabled={saving} style={{ background: '#10b981', color: '#fff', border: 'none' }}>
                            {saving ? 'Saving...' : '✅ Confirm Dispatch'}
                        </button>
                    </>
                )}
                {canPack && (
                    <button className="ui-btn primary" onClick={handleMarkPacked} disabled={saving} style={{ background: '#6366f1', color: '#fff', border: 'none' }}>
                        {saving ? 'Saving...' : '📦 Mark Packed'}
                    </button>
                )}
                {canOutForDelivery && (
                    <button className="ui-btn primary" onClick={handleMarkOutForDelivery} disabled={saving} style={{ background: '#0ea5e9', color: '#fff', border: 'none' }}>
                        {saving ? 'Saving...' : '🚚 Out for Delivery'}
                    </button>
                )}
                {canActionMonDeliver && (
                    <button className="ui-btn primary" onClick={() => handleMarkDelivered('Monday')} disabled={saving} style={{ background: '#3b82f6', color: '#fff', border: 'none' }}>
                        {saving ? 'Saving...' : '✓ Monday Delivered'}
                    </button>
                )}
                {canActionThuDeliver && (
                    <button className="ui-btn primary" onClick={() => handleMarkDelivered('Thursday')} disabled={saving} style={{ background: '#3b82f6', color: '#fff', border: 'none' }}>
                        {saving ? 'Saving...' : '✓ Thursday Delivered'}
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

            {/* Partial Confirmation Modal — Enhanced with substitute + reason */}
            {showPartialModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <div style={{ background: '#1e293b', padding: 24, borderRadius: 12, width: '100%', maxWidth: 960, maxHeight: '90vh', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
                        <h2 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 600 }}>Partially Confirm Dispatch</h2>
                        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24 }}>Adjust quantities, mark unavailable items, and optionally suggest substitutes.</p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, color: '#e2e8f0', fontSize: 14, fontWeight: 500 }}>Overall Reason <span style={{ color: '#f43f5e' }}>*</span></label>
                                <input className="ui-input" value={partialReason} onChange={(e) => setPartialReason(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)' }} placeholder="e.g. Tomato shortage, reducing Monday qty..." />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, color: '#e2e8f0', fontSize: 14, fontWeight: 500 }}>Estimated Delivery</label>
                                <input className="ui-input" value={estimatedDelivery} onChange={(e) => setEstimatedDelivery(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)' }} placeholder="e.g. Monday 6:00 AM" />
                            </div>
                        </div>

                        <div style={{ overflowX: 'auto', marginBottom: 24 }}>
                            <table className="ui-table" style={{ width: '100%' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Item</th>
                                        <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Available</th>
                                        <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Mon Qty</th>
                                        <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Thu Qty</th>
                                        <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Substitute</th>
                                        <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Reason / Note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {partialItems.map((item, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                            <td style={{ fontWeight: 500, padding: '10px 12px' }}>
                                                <div>{item.itemName}</div>
                                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.packLabel}</div>
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 8px' }}>
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
                                            <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.mondayQty || 0}→</span>
                                                    <input type="number" className="ui-input" style={{ width: 56, padding: 6, textAlign: 'center', background: 'rgba(0,0,0,0.5)' }}
                                                        min="0" max={item.mondayQty || 0} value={item.confirmedMondayQty} disabled={item.status === 'unavailable'}
                                                        onChange={(e) => { const copy = [...partialItems]; copy[idx].confirmedMondayQty = parseInt(e.target.value) || 0; setPartialItems(copy); }}
                                                    />
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.thursdayQty || 0}→</span>
                                                    <input type="number" className="ui-input" style={{ width: 56, padding: 6, textAlign: 'center', background: 'rgba(0,0,0,0.5)' }}
                                                        min="0" max={item.thursdayQty || 0} value={item.confirmedThursdayQty} disabled={item.status === 'unavailable'}
                                                        onChange={(e) => { const copy = [...partialItems]; copy[idx].confirmedThursdayQty = parseInt(e.target.value) || 0; setPartialItems(copy); }}
                                                    />
                                                </div>
                                            </td>
                                            <td style={{ padding: '10px 8px' }}>
                                                <input className="ui-input" style={{ width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.5)', fontSize: 12 }}
                                                    placeholder="e.g. Roma tomatoes instead..."
                                                    value={item.substituteText || ''}
                                                    onChange={(e) => { const copy = [...partialItems]; copy[idx].substituteText = e.target.value; setPartialItems(copy); }}
                                                />
                                            </td>
                                            <td style={{ padding: '10px 8px' }}>
                                                <input className="ui-input" style={{ width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.5)', fontSize: 12 }}
                                                    placeholder="Reason..."
                                                    value={item.vendorReason || item.note || ''}
                                                    onChange={(e) => { const copy = [...partialItems]; copy[idx].vendorReason = e.target.value; copy[idx].note = e.target.value; setPartialItems(copy); }}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Summary */}
                        {partialItems.length > 0 && (() => {
                            const totalReq = partialItems.reduce((s, i) => s + (i.mondayQty || 0) + (i.thursdayQty || 0), 0);
                            const totalConf = partialItems.reduce((s, i) => s + (i.confirmedMondayQty || 0) + (i.confirmedThursdayQty || 0), 0);
                            const totalUnavail = totalReq - totalConf;
                            const withSubs = partialItems.filter(i => i.substituteText?.trim()).length;
                            return (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
                                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>{totalReq}</div>
                                        <div style={{ fontSize: 11, color: '#94a3b8' }}>Requested</div>
                                    </div>
                                    <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{totalConf}</div>
                                        <div style={{ fontSize: 11, color: '#94a3b8' }}>Confirmed</div>
                                    </div>
                                    <div style={{ background: 'rgba(244,63,94,0.06)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#f43f5e' }}>{totalUnavail}</div>
                                        <div style={{ fontSize: 11, color: '#94a3b8' }}>Unavailable</div>
                                    </div>
                                    <div style={{ background: 'rgba(167,139,250,0.06)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: '#a78bfa' }}>{withSubs}</div>
                                        <div style={{ fontSize: 11, color: '#94a3b8' }}>Substitutes</div>
                                    </div>
                                </div>
                            );
                        })()}

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
