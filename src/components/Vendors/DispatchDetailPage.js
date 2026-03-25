import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../../contexts/UserContext';
import { db, app } from '../../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, getDocs, updateDoc, deleteDoc, serverTimestamp, collection, query, where, limit } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { logDispatchSent } from '../../utils/adminAuditLogger';
import { ops } from '../../services/operationsLogger';
import '../../components/Orders/OrdersPage.css';
import { getTaxRate } from '../../constants/taxRates';
import { authFetch } from '../../utils/authFetch';


const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Status Configs ──────────────────────────────────────────────────────────
const STATUS_CONFIG = {
    'Sent':                  { bg: 'rgba(56, 189, 248, 0.15)',  color: '#38bdf8', icon: '📩', label: 'Sent' },
    'Vendor Reviewing':      { bg: 'rgba(168,85,247,0.15)',     color: '#a855f7', icon: '👁️', label: 'Reviewing' },
    'Confirmed':             { bg: 'rgba(16, 185, 129, 0.15)',  color: '#10b981', icon: '✅', label: 'Confirmed' },
    'Partially Confirmed':   { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', icon: '⚠️', label: 'Partial' },
    'Rejected':              { bg: 'rgba(244, 63, 94, 0.15)',   color: '#f43f5e', icon: '❌', label: 'Rejected' },
    'Cancelled by Customer': { bg: 'rgba(251, 146, 60, 0.15)',  color: '#fb923c', icon: '🚫', label: 'Cancelled' },
    'Packed':                { bg: 'rgba(99,102,241,0.15)',     color: '#6366f1', icon: '📦', label: 'Packed' },
    'Out for Delivery':      { bg: 'rgba(14,165,233,0.15)',     color: '#0ea5e9', icon: '🚚', label: 'In Transit' },
    'Delivered':             { bg: 'rgba(16, 185, 129, 0.15)',  color: '#10b981', icon: '✓',  label: 'Delivered' },
    'Pending Customer Approval': { bg: 'rgba(244,114,182,0.15)', color: '#f472b6', icon: '⏳', label: 'Pending Approval' },
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
    const { vendorId, isSuperAdmin, displayName } = useContext(UserContext);

    const [dispatch, setDispatch] = useState(null);
    const [loading, setLoading] = useState(true);
    const [restaurantInfo, setRestaurantInfo] = useState(null);
    const [notes, setNotes] = useState('');
    const [estimatedDelivery, setEstimatedDelivery] = useState('');

    // Modals state
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [showPartialModal, setShowPartialModal] = useState(false);
    const [partialItems, setPartialItems] = useState([]);
    const [partialReason, setPartialReason] = useState('');
    const [saving, setSaving] = useState(false);

    // ── Marketplace order management state ──
    const [editableItems, setEditableItems] = useState([]);
    const [itemReasons, setItemReasons] = useState({});
    const [showAcceptForm, setShowAcceptForm] = useState(false);
    const [pickupDate, setPickupDate] = useState('');
    const [pickupTime, setPickupTime] = useState('');
    const [cancelModalAction, setCancelModalAction] = useState(null);
    const [cancelReason, setCancelReason] = useState('');

    // ── Resolution state (superadmin in_review) ──
    const [resolutionItems, setResolutionItems] = useState([]);
    const [resolutionAction, setResolutionAction] = useState('');
    const [resolutionNotes, setResolutionNotes] = useState('');

    const canManageOrders = !isSuperAdmin; // vendor admins manage their own orders

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
                        else if (s === 'pending_fulfillment') dispatchStatus = 'Confirmed';
                        else if (s === 'pending_customer_approval') dispatchStatus = 'Pending Customer Approval';
                        else if (s === 'delivery_in_route') dispatchStatus = 'Out for Delivery';
                        else if (s === 'delivered_awaiting_confirmation' || s === 'fulfilled') dispatchStatus = 'Delivered';
                        else if (s === 'cancelled_by_vendor' || s === 'rejected') dispatchStatus = 'Rejected';
                        else if (s === 'cancelled_by_customer') dispatchStatus = 'Cancelled by Customer';
                        else if (s === 'in_review') dispatchStatus = 'Vendor Reviewing';

                        // Keep raw marketplace items (no Monday/Thursday conversion)
                        const rawItems = data.items || [];
                        const total = data.grandTotalAfterTax || data.total || 0;

                        // Also build dispatch-style items for fallback table
                        const dispatchItems = rawItems.map(item => ({
                            itemName: item.name || item.itemName || 'Unknown Item',
                            packLabel: item.unit || item.packSize || '—',
                            mondayQty: item.qty || 0,
                            thursdayQty: 0,
                            confirmedMondayQty: item.qty || 0,
                            confirmedThursdayQty: 0,
                        }));

                        const orderData = {
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
                            items: dispatchItems,
                            // Raw marketplace data for order management
                            _rawItems: rawItems,
                            _source: 'marketplace',
                            _marketplaceStatus: s,
                            _marketplaceRaw: data,
                            taxRate: data.taxRate || 0,
                            subtotalBeforeTax: data.subtotalBeforeTax || data.subtotal || 0,
                            totalTax: data.totalTax || data.taxTotal || 0,
                            grandTotalAfterTax: data.grandTotalAfterTax || data.total || 0,
                            total: total,
                            orderGroupId: data.orderGroupId || '',
                            restaurantId: data.restaurantId || '',
                            auditLog: data.auditLog || [],
                            pickupDate: data.pickupDate || '',
                            pickupTime: data.pickupTime || '',
                            cancellationReason: data.cancellationReason || '',
                            cancelledBy: data.cancelledBy || '',
                            cancelledAt: data.cancelledAt || null,
                            issueReport: data.issueReport || null,
                            issueDetails: data.issueDetails || null,
                            issueStatus: data.issueStatus || '',
                            reviewWindowEndsAt: data.reviewWindowEndsAt || null,
                            taxIntegrityStatus: data.taxIntegrityStatus || '',
                        };
                        setDispatch(orderData);
                        // Initialize editable items from raw marketplace items
                        setEditableItems(JSON.parse(JSON.stringify(rawItems)));
                        setResolutionItems(JSON.parse(JSON.stringify(rawItems)));
                        setItemReasons({});
                        setShowAcceptForm(false);
                        setPickupDate(data.pickupDate || '');
                        setPickupTime(data.pickupTime || '');
                        setCancelModalAction(null);
                        setCancelReason('');
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

    // Fetch restaurant contact info once dispatch.restaurantId is available
    useEffect(() => {
        if (!dispatch?.restaurantId) return;
        const fetchRestaurantInfo = async (rid) => {
            try {
                const docSnap = await getDoc(doc(db, 'restaurants', rid));
                if (docSnap.exists()) {
                    setRestaurantInfo(docSnap.data());
                    return;
                }
                const q = query(collection(db, 'restaurants'), where('restaurantId', '==', rid), limit(1));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    setRestaurantInfo(snap.docs[0].data());
                }
            } catch (err) {
                console.warn('Could not fetch restaurant info:', err);
            }
        };
        fetchRestaurantInfo(dispatch.restaurantId);
    }, [dispatch?.restaurantId]);

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

    // ── Marketplace Order Handlers ──────────────────────────────────────

    const handleConfirmAcceptMarketplace = async () => {
        if (!pickupDate || !pickupTime) {
            toast.warn('Please select both a pickup date and time.');
            return;
        }

        // Validate pickup date/time is not in the past
        const now = new Date();
        const pickupDateTime = new Date(`${pickupDate}T${pickupTime}`);
        const today = now.toISOString().split('T')[0];
        if (pickupDate < today) {
            toast.warn('Pickup date cannot be in the past.');
            return;
        }
        if (pickupDate === today && pickupDateTime <= now) {
            toast.warn('Pickup time cannot be in the past.');
            return;
        }

        const rawItems = dispatch._rawItems || [];
        const auditLogEntries = [];
        let hasMissingReason = false;

        editableItems.forEach((item, index) => {
            const originalItem = rawItems[index];
            if (item.qty < originalItem.qty) {
                const reason = itemReasons[index]?.trim();
                if (!reason) {
                    hasMissingReason = true;
                } else {
                    const actionName = item.qty === 0 ? 'rejected' : 'quantity reduced';
                    auditLogEntries.push({
                        action: `Item "${item.name}" ${actionName} from ${originalItem.qty} to ${item.qty}`,
                        reason: reason,
                        timestamp: new Date().toISOString(),
                        user: dispatch.vendorName || 'Vendor'
                    });
                }
            }
        });

        if (hasMissingReason) {
            toast.warn('Please provide a reason for all reduced or rejected items.');
            return;
        }

        // Calculate new totals
        let subtotalBeforeTax = 0;
        let totalTax = 0;
        const taxRate = dispatch.taxRate || 0;

        editableItems.forEach(item => {
            const lineSubtotal = round2((item.vendorPrice ?? item.price ?? 0) * item.qty);
            item.lineSubtotal = lineSubtotal;
            subtotalBeforeTax += lineSubtotal;
            if (item.taxable) {
                totalTax += round2(lineSubtotal * taxRate);
            }
        });

        subtotalBeforeTax = round2(subtotalBeforeTax);
        totalTax = round2(totalTax);
        const grandTotalAfterTax = round2(subtotalBeforeTax + totalTax);

        setSaving(true);
        try {
            const hasModifications = auditLogEntries.length > 0;
            const newStatus = hasModifications ? 'pending_customer_approval' : 'pending_fulfillment';

            const orderRef = doc(db, 'marketplaceOrders', dispatchId);
            const updatePayload = {
                status: newStatus,
                pickupDate,
                pickupTime,
                items: editableItems,
                subtotalBeforeTax,
                totalTax,
                grandTotalAfterTax,
                total: grandTotalAfterTax
            };

            if (hasModifications) {
                const updatedAuditLog = [...(dispatch.auditLog || []), ...auditLogEntries];
                updatePayload.auditLog = updatedAuditLog;
            }

            await updateDoc(orderRef, updatePayload);
            toast.success(hasModifications ? 'Changes submitted for customer approval!' : 'Order accepted with scheduled pickup!');

            // Send order confirmation email via Cloud Function
            try {
                let toEmail = '';
                let restaurantName = dispatch.restaurantId;
                try {
                    const res = await authFetch(`/api/restaurant-info/${dispatch.restaurantId}`);
                    if (res.ok) {
                        const info = await res.json();
                        toEmail = info.email || '';
                        restaurantName = info.businessName || dispatch.restaurantId;
                    }
                } catch (fetchErr) {
                    console.warn('Could not fetch restaurant info for email:', fetchErr);
                }

                if (toEmail) {
                    const functions = getFunctions(app);
                    const sendEmail = httpsCallable(functions, 'sendOrderConfirmationEmailFn');
                    await sendEmail({ orderId: dispatch.id, toEmail, restaurantName });
                    toast.info(`📧 Confirmation email sent to ${toEmail}`);
                }
            } catch (emailError) {
                console.error('Email notification failed:', emailError);
                toast.warn('Email notification failed (order still accepted).');
            }

            // Map new marketplace status back to dispatch display status
            const newDisplayStatus = hasModifications ? 'Confirmed' : 'Confirmed';
            setDispatch(prev => ({
                ...prev,
                ...updatePayload,
                status: newDisplayStatus,
                _marketplaceStatus: newStatus,
                _rawItems: editableItems,
                subtotalBeforeTax,
                totalTax,
                grandTotalAfterTax,
                total: grandTotalAfterTax,
            }));
            setShowAcceptForm(false);
        } catch (error) {
            console.error('Error accepting order:', error);
            toast.error('Failed to accept order');
        } finally {
            setSaving(false);
        }
    };

    const handleCancelOrderMarketplace = async () => {
        if (!cancelReason.trim()) {
            toast.warn(`Please provide a reason for ${cancelModalAction === 'reject' ? 'rejection' : 'cancellation'}.`);
            return;
        }

        const actionLabel = cancelModalAction === 'reject' ? 'Order rejected by vendor' : 'Order cancelled by vendor';

        setSaving(true);
        try {
            const orderRef = doc(db, 'marketplaceOrders', dispatchId);
            const auditEntry = {
                action: actionLabel,
                reason: cancelReason.trim(),
                timestamp: new Date().toISOString(),
                user: dispatch.vendorName || 'Vendor'
            };
            const updatedAuditLog = [...(dispatch.auditLog || []), auditEntry];

            const updatePayload = {
                status: 'cancelled_by_vendor',
                auditLog: updatedAuditLog,
                cancelledAt: serverTimestamp(),
                cancelReason: cancelReason.trim()
            };

            await updateDoc(orderRef, updatePayload);
            toast.success('Order has been cancelled.');
            setDispatch(prev => ({ ...prev, status: 'Rejected', _marketplaceStatus: 'cancelled_by_vendor', auditLog: updatedAuditLog }));
            setCancelModalAction(null);
            setCancelReason('');
        } catch (error) {
            console.error('Error cancelling order:', error);
            toast.error('Failed to cancel order');
        } finally {
            setSaving(false);
        }
    };

    const handleMarketplaceMark = async (newMarketplaceStatus, newDisplayStatus, extras = {}) => {
        setSaving(true);
        try {
            const orderRef = doc(db, 'marketplaceOrders', dispatchId);
            const auditEntry = {
                action: `Order status changed to ${newMarketplaceStatus.replace(/_/g, ' ')}`,
                timestamp: new Date().toISOString(),
                user: dispatch.vendorName || 'Vendor'
            };
            const updatedAuditLog = [...(dispatch.auditLog || []), auditEntry];

            await updateDoc(orderRef, {
                status: newMarketplaceStatus,
                updatedAt: serverTimestamp(),
                auditLog: updatedAuditLog,
                ...extras,
            });

            setDispatch(prev => ({
                ...prev,
                status: newDisplayStatus,
                _marketplaceStatus: newMarketplaceStatus,
                auditLog: updatedAuditLog,
            }));
            toast.success(`Status updated to ${newDisplayStatus}`);
        } catch (err) {
            console.error(`Error updating to ${newMarketplaceStatus}:`, err);
            toast.error('Failed to update status');
        } finally {
            setSaving(false);
        }
    };

    const handleMarketplaceInRoute = () => handleMarketplaceMark('delivery_in_route', 'Out for Delivery');

    const handleMarketplaceDelivered = () => {
        const now = new Date();
        const reviewWindowEndsAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
        handleMarketplaceMark('delivered_awaiting_confirmation', 'Delivered', {
            deliveredAt: serverTimestamp(),
            reviewWindowEndsAt,
        });
    };

    const formatMarketplaceDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString();
    };

    const formatMarketplaceCurrency = (amount) => {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
    };

    // ── Super Admin Handlers ────────────────────────────────────────────

    const deleteOrder = async () => {
        if (!window.confirm("Are you sure you want to delete this order? This action cannot be undone.")) return;
        try {
            const orderRef = doc(db, 'marketplaceOrders', dispatchId);
            await deleteDoc(orderRef);
            toast.success("Order deleted successfully");
            navigate('/dispatch-requests');
        } catch (error) {
            console.error("Error deleting order:", error);
            toast.error("Failed to delete order");
        }
    };

    const getReviewWindowStatus = () => {
        if (!dispatch?.reviewWindowEndsAt) return null;
        const endsAt = new Date(dispatch.reviewWindowEndsAt);
        const now = new Date();
        const diff = endsAt - now;
        if (diff <= 0) return { expired: true, text: 'Review window has expired' };
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return { expired: false, text: `${hours}h ${minutes}m remaining` };
    };

    const handleResolveIssue = async () => {
        if (!resolutionAction) { toast.warn('Please select a resolution action.'); return; }
        setSaving(true);
        try {
            const orderRef = doc(db, 'marketplaceOrders', dispatchId);
            const taxRate = dispatch.taxRate || 0;

            let subtotalBeforeTax = 0;
            let totalTax = 0;
            resolutionItems.forEach(item => {
                const lineSubtotal = round2((item.vendorPrice ?? item.price ?? 0) * item.qty);
                subtotalBeforeTax += lineSubtotal;
                if (item.taxable) totalTax += round2(lineSubtotal * taxRate);
            });
            subtotalBeforeTax = round2(subtotalBeforeTax);
            totalTax = round2(totalTax);
            const grandTotalAfterTax = round2(subtotalBeforeTax + totalTax);

            const rawItems = dispatch._rawItems || [];
            const itemAuditEntries = [];
            resolutionItems.forEach((item, idx) => {
                const orig = rawItems[idx];
                if (orig && item.qty !== orig.qty) {
                    itemAuditEntries.push({
                        action: `Item "${item.name}" qty adjusted from ${orig.qty} to ${item.qty}`,
                        reason: resolutionNotes || 'Admin resolution',
                        timestamp: new Date().toISOString(),
                        user: displayName || 'SuperAdmin'
                    });
                }
            });

            const resolutionEntry = {
                action: `Issue resolved — ${resolutionAction.replace(/_/g, ' ')}`,
                reason: resolutionNotes || 'Resolved by admin',
                timestamp: new Date().toISOString(),
                user: displayName || 'SuperAdmin'
            };

            const updatedAuditLog = [...(dispatch.auditLog || []), ...itemAuditEntries, resolutionEntry];

            await updateDoc(orderRef, {
                status: 'fulfilled',
                issueStatus: 'resolved',
                resolutionAction: {
                    type: resolutionAction,
                    details: resolutionNotes,
                    resolvedBy: displayName || 'SuperAdmin',
                    resolvedAt: serverTimestamp()
                },
                resolvedAt: serverTimestamp(),
                items: resolutionItems,
                subtotalBeforeTax,
                totalTax,
                grandTotalAfterTax,
                total: grandTotalAfterTax,
                auditLog: updatedAuditLog
            });

            toast.success('Issue resolved. Order finalized.');

            // Sync invoices
            try {
                const vendorSnap = await getDoc(doc(db, 'vendors', dispatch.vendorId || ''));
                const vData = vendorSnap.exists() ? vendorSnap.data() : {};
                const invoiceTaxRate = getTaxRate(vData.country || 'Canada', vData.province);
                const vendorCommissionPercent = Number(vData.commissionPercent ?? 10);

                let invSubtotal = 0, invTotalTax = 0;
                const invoiceItems = resolutionItems.map(item => {
                    const price = Number(item.vendorPrice ?? item.price ?? 0);
                    const qty = item.qty || 1;
                    const lineTotal = round2(price * qty);
                    const isTaxable = !!item.taxable;
                    const lineTax = isTaxable ? round2(lineTotal * (invoiceTaxRate / 100)) : 0;
                    invSubtotal += lineTotal;
                    invTotalTax += lineTax;
                    return { itemId: item.itemId, itemName: item.name || 'Unknown Item', unit: item.unit || 'unit', qty, price, vendorPrice: price, lineTotal, lineTotalVendor: lineTotal, isTaxable, lineTax };
                });
                invSubtotal = round2(invSubtotal);
                invTotalTax = round2(invTotalTax);
                const invGrandTotal = round2(invSubtotal + invTotalTax);

                const restInvRef = doc(db, 'restaurantInvoices', dispatchId);
                const restInvSnap = await getDoc(restInvRef);
                if (restInvSnap.exists()) {
                    await updateDoc(restInvRef, { items: invoiceItems, subtotal: invSubtotal, totalTax: invTotalTax, grandTotal: invGrandTotal, updatedAt: serverTimestamp(), adminNotes: 'Updated after issue resolution' });
                }

                const vendorInvRef = doc(db, 'vendorInvoices', dispatchId);
                const vendorInvSnap = await getDoc(vendorInvRef);
                if (vendorInvSnap.exists()) {
                    const commissionAmount = round2(invSubtotal * (vendorCommissionPercent / 100));
                    const netVendorPayable = round2(invSubtotal - commissionAmount);
                    await updateDoc(vendorInvRef, { items: invoiceItems, subtotalVendorAmount: invSubtotal, grossVendorAmount: invSubtotal, totalTaxAmount: invTotalTax, totalVendorAmount: invGrandTotal, commissionAmount, netVendorPayable, updatedAt: serverTimestamp(), adminNotes: 'Updated after issue resolution' });
                }
            } catch (invoiceErr) {
                console.error('Failed to sync invoices after resolution:', invoiceErr);
            }

            setDispatch(prev => ({
                ...prev,
                status: 'Delivered',
                _marketplaceStatus: 'fulfilled',
                issueStatus: 'resolved',
                items: resolutionItems,
                _rawItems: resolutionItems,
                subtotalBeforeTax, totalTax, grandTotalAfterTax,
                total: grandTotalAfterTax,
                auditLog: updatedAuditLog
            }));
            setResolutionAction('');
            setResolutionNotes('');
        } catch (error) {
            console.error('Error resolving issue:', error);
            toast.error('Failed to resolve issue');
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

    // ── Marketplace Order Render ──────────────────────────────────────────
    const renderMarketplaceOrder = () => {
        const mStatus = dispatch._marketplaceStatus || '';
        const rawItems = dispatch._rawItems || [];
        const isEditable = mStatus === 'pending_confirmation';
        const displayItems = isEditable ? editableItems : rawItems;

        const computedSubtotal = displayItems.reduce((sum, item) => sum + ((item.vendorPrice ?? item.price ?? 0) * item.qty), 0);
        const taxRate = dispatch.taxRate || 0;

        return (
            <>
                {/* Order Info Grid */}
                <div className="order-info-grid" style={{ marginBottom: 24 }}>
                    <div className="info-item">
                        <span className="info-label">Order ID</span>
                        <span className="info-value">{dispatch.orderGroupId || dispatch.id?.slice(-8).toUpperCase()}</span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Date</span>
                        <span className="info-value">{formatMarketplaceDate(dispatch.sentAt)}</span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Restaurant</span>
                        <span className="info-value">{dispatch.restaurantName}</span>
                    </div>
                    {restaurantInfo && (restaurantInfo.address || restaurantInfo.city || restaurantInfo.province) && (
                        <div className="info-item">
                            <span className="info-label">Address</span>
                            <span className="info-value">{[restaurantInfo.address, restaurantInfo.city, restaurantInfo.province, restaurantInfo.postalCode].filter(Boolean).join(', ')}</span>
                        </div>
                    )}
                    {restaurantInfo && restaurantInfo.phone && (
                        <div className="info-item">
                            <span className="info-label">Phone</span>
                            <span className="info-value"><a href={`tel:${restaurantInfo.phone}`} style={{ color: '#38bdf8', textDecoration: 'none' }}>{restaurantInfo.phone}</a></span>
                        </div>
                    )}
                    {restaurantInfo && restaurantInfo.email && (
                        <div className="info-item">
                            <span className="info-label">Email</span>
                            <span className="info-value"><a href={`mailto:${restaurantInfo.email}`} style={{ color: '#38bdf8', textDecoration: 'none' }}>{restaurantInfo.email}</a></span>
                        </div>
                    )}
                    <div className="info-item">
                        <span className="info-label">Status</span>
                        <span className={`status-badge ${mStatus}`}>{mStatus.replace(/_/g, ' ')}</span>
                    </div>
                    {isSuperAdmin && dispatch.vendorName && (
                        <div className="info-item">
                            <span className="info-label">Vendor</span>
                            <span className="info-value">{dispatch.vendorName}</span>
                        </div>
                    )}
                </div>

                {/* Cancellation Reason */}
                {dispatch.cancellationReason && (
                    <div style={{ background: 'rgba(251, 146, 60, 0.1)', padding: 16, borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #fb923c' }}>
                        <strong style={{ color: '#fb923c', fontSize: 13, textTransform: 'uppercase' }}>Cancellation Reason</strong>
                        <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 14 }}>{dispatch.cancellationReason}</div>
                        {dispatch.cancelledBy && (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>Cancelled by: {dispatch.cancelledBy}</div>
                        )}
                    </div>
                )}

                {/* Pickup Info */}
                {dispatch.pickupDate && (
                    <div style={{ background: 'rgba(99,102,241,0.08)', padding: 16, borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #6366f1' }}>
                        <strong style={{ color: '#6366f1', fontSize: 13, textTransform: 'uppercase' }}>Scheduled Pickup</strong>
                        <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 14 }}>{dispatch.pickupDate} at {dispatch.pickupTime}</div>
                    </div>
                )}

                {/* Items Table */}
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#e2e8f0' }}>Order Items</h3>
                <table className="order-items-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Price</th>
                            <th>Qty</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayItems.map((item, idx) => {
                            const originalItem = rawItems[idx] || item;
                            const isModified = isEditable && item.qty < originalItem.qty;
                            return (
                                <React.Fragment key={idx}>
                                    <tr style={{ opacity: item.qty === 0 ? 0.5 : 1 }}>
                                        <td className="item-name-cell">
                                            {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="item-thumbnail" />}
                                            <div>
                                                <div style={{ fontWeight: 500, textDecoration: item.qty === 0 ? 'line-through' : 'none' }}>{item.name}</div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                    {item.brand && `${item.brand} • `}{item.packSize || item.unit}
                                                    {item.taxable && <span style={{ marginLeft: 6, fontSize: '10px', fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.12)', padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle' }}>TAX</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td>{formatMarketplaceCurrency(item.price)}</td>
                                        <td>
                                            {isEditable ? (
                                                <input type="number" className="ui-input" style={{ width: '70px', padding: '4px 8px' }}
                                                    min="0" max={originalItem.qty} value={item.qty}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value) || 0;
                                                        const newQty = Math.max(0, Math.min(originalItem.qty, val));
                                                        const newItems = [...editableItems];
                                                        newItems[idx].qty = newQty;
                                                        setEditableItems(newItems);
                                                    }}
                                                />
                                            ) : item.qty}
                                        </td>
                                        <td>{formatMarketplaceCurrency(item.price * item.qty)}</td>
                                    </tr>
                                    {isModified && isEditable && (
                                        <tr>
                                            <td colSpan="4" style={{ paddingTop: 0, paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(239, 68, 68, 0.05)', padding: '8px 12px', borderRadius: '6px', borderLeft: '3px solid #ef4444' }}>
                                                    <span style={{ fontSize: '13px', color: '#ef4444' }}>Reason for {item.qty === 0 ? 'rejection' : 'reduction'}:</span>
                                                    <input type="text" className="ui-input" style={{ flex: 1, padding: '4px 8px', fontSize: '13px' }}
                                                        placeholder="e.g. Out of stock, damaged..."
                                                        value={itemReasons[idx] || ''}
                                                        onChange={(e) => setItemReasons(prev => ({ ...prev, [idx]: e.target.value }))}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>

                {/* Order Summary */}
                <div className="order-summary">
                    <div className="summary-row">
                        <span>Subtotal</span>
                        <span>{formatMarketplaceCurrency(dispatch.subtotalBeforeTax || computedSubtotal)}</span>
                    </div>
                    <div className="summary-row">
                        <span>Tax ({((taxRate) * 100).toFixed(0)}%)</span>
                        <span>{formatMarketplaceCurrency(dispatch.totalTax || 0)}</span>
                    </div>
                    <div className="summary-row total">
                        <span>Total</span>
                        <span>{formatMarketplaceCurrency(dispatch.grandTotalAfterTax || dispatch.total || 0)}</span>
                    </div>
                </div>

                {dispatch.taxIntegrityStatus === 'MISMATCH' && (
                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', fontSize: '12px', color: '#ef4444' }}>
                        ⚠️ <strong>Tax Mismatch:</strong> The stored total does not match calculated line items.
                    </div>
                )}

                {/* Actions: pending_confirmation */}
                {mStatus === 'pending_confirmation' && (
                    <div className="order-actions">
                        {showAcceptForm ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', padding: '16px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px' }}>
                                <h4 style={{ margin: 0, fontSize: '15px' }}>Confirm Pickup Details</h4>
                                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: 13 }}>Ready Date</label>
                                        <input type="date" className="ui-input" value={pickupDate} min={new Date().toISOString().split('T')[0]} onChange={e => setPickupDate(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', borderRadius: 8 }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ display: 'block', marginBottom: 6, color: '#94a3b8', fontSize: 13 }}>Ready Time</label>
                                        <input type="time" className="ui-input" value={pickupTime} onChange={e => setPickupTime(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', borderRadius: 8 }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                    <button className="btn-accept" onClick={handleConfirmAcceptMarketplace} disabled={!pickupDate || !pickupTime || saving}>
                                        {saving ? 'Saving...' : editableItems.some((item, idx) => item.qty < (rawItems[idx]?.qty || item.qty)) ? 'Submit Changes for Approval' : 'Confirm & Accept'}
                                    </button>
                                    <button className="ui-btn ghost" onClick={() => setShowAcceptForm(false)}>Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <button className="btn-reject" onClick={() => setCancelModalAction('reject')}>✗ Reject Order</button>
                                <button className="btn-accept" onClick={() => setShowAcceptForm(true)}>✓ Accept Order</button>
                            </>
                        )}
                    </div>
                )}

                {/* Actions: pending_fulfillment */}
                {mStatus === 'pending_fulfillment' && (
                    <div className="order-actions">
                        <button className="btn-reject" onClick={() => setCancelModalAction('cancel')}>✗ Cancel Order</button>
                        <button className="btn-accept" style={{ flex: 1 }} onClick={handleMarketplaceInRoute}>🚚 Mark as Picked Up / In Route</button>
                    </div>
                )}

                {/* Actions: delivery_in_route */}
                {mStatus === 'delivery_in_route' && (
                    <div className="order-actions">
                        <button className="btn-reject" onClick={() => setCancelModalAction('cancel')}>✗ Cancel Order</button>
                        <button className="btn-accept" style={{ flex: 1 }} onClick={handleMarketplaceDelivered}>📦 Mark as Delivered</button>
                    </div>
                )}

                {/* Review Window Banner — delivered_awaiting_confirmation */}
                {mStatus === 'delivered_awaiting_confirmation' && (() => {
                    const windowStatus = getReviewWindowStatus();
                    return (
                        <>
                            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10 }}>
                                <span style={{ fontSize: 24 }}>⏳</span>
                                <div>
                                    <strong style={{ color: '#f59e0b' }}>Awaiting Restaurant Confirmation</strong>
                                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {windowStatus?.expired
                                            ? 'Review window has expired — awaiting auto-confirmation'
                                            : `Review window: ${windowStatus?.text}`}
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                                🚫 Invoice generation blocked until confirmation
                            </div>
                        </>
                    );
                })()}

                {/* Issue Reported Banner — in_review */}
                {mStatus === 'in_review' && (
                    <>
                        <div style={{ marginTop: 24, padding: 16, background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.3)', borderRadius: 10 }}>
                            <h4 style={{ margin: '0 0 8px 0', color: '#f97316' }}>⚠️ Issue Reported by Restaurant</h4>
                            {dispatch.issueReport?.type && (
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                                    {dispatch.issueReport.type}
                                </div>
                            )}
                            <div style={{ color: 'var(--text-primary)', fontSize: 14 }}>
                                {dispatch.issueReport?.notes || dispatch.issueDetails?.description || 'No details provided'}
                            </div>
                            {dispatch.issueReport?.items?.length > 0 && (
                                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(249, 115, 22, 0.2)' }}>
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Affected Items:</span>
                                    {dispatch.issueReport.items.map((item, idx) => (
                                        <div key={idx} style={{ fontSize: 13, padding: '2px 0' }}>
                                            • <strong>{item.name}</strong> (x{item.qty}){item.notes ? ` — "${item.notes}"` : ''}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                                <span>Reported by: {dispatch.issueReport?.reportedBy || dispatch.issueDetails?.reportedBy || 'Restaurant'}</span>
                                <span>Date: {formatMarketplaceDate(dispatch.issueReport?.reportedAt || dispatch.issueDetails?.reportedAt)}</span>
                            </div>
                        </div>
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                            🚫 Invoice generation blocked — issue under review
                        </div>

                        {/* SuperAdmin Resolution Panel */}
                        {isSuperAdmin && (
                            <div style={{ marginTop: 16, padding: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 10 }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: 15 }}>🔧 Resolve Issue</h4>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                                    {['update_quantity', 'void_item', 'approve_partial', 'reject_claim'].map(action => (
                                        <button key={action} onClick={() => setResolutionAction(action)}
                                            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: '1px solid var(--border-color)', background: resolutionAction === action ? 'rgba(99,102,241,0.2)' : 'transparent', color: resolutionAction === action ? '#818cf8' : 'var(--text-secondary)' }}>
                                            {action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                        </button>
                                    ))}
                                </div>
                                {resolutionAction && resolutionAction !== 'reject_claim' && (
                                    <>
                                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>Adjust item quantities below. Voided items should be set to 0.</p>
                                        <table className="order-items-table" style={{ marginBottom: 16 }}>
                                            <thead><tr><th>Item</th><th>Original Qty</th><th>Adjusted Qty</th><th>Total</th></tr></thead>
                                            <tbody>
                                                {resolutionItems.map((item, idx) => (
                                                    <tr key={idx} style={{ opacity: item.qty === 0 ? 0.5 : 1 }}>
                                                        <td>{item.name}</td>
                                                        <td>{rawItems[idx]?.qty || item.qty}</td>
                                                        <td><input type="number" className="ui-input" style={{ width: 70, padding: '4px 8px' }} min="0" value={item.qty} onChange={(e) => { const val = Math.max(0, parseInt(e.target.value) || 0); const updated = [...resolutionItems]; updated[idx].qty = val; setResolutionItems(updated); }} /></td>
                                                        <td>{formatMarketplaceCurrency((item.vendorPrice ?? item.price ?? 0) * item.qty)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </>
                                )}
                                <textarea className="ui-input" rows={2} placeholder="Resolution notes..." value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)} style={{ width: '100%', resize: 'vertical', fontSize: 13, marginBottom: 12 }} />
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <button className="btn-accept" onClick={handleResolveIssue} disabled={!resolutionAction || saving}>{saving ? 'Processing...' : '✅ Approve & Finalize Order'}</button>
                                </div>
                            </div>
                        )}
                        {!isSuperAdmin && (
                            <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: 13, color: 'var(--text-secondary)' }}>
                                This order is under review by the admin team. You will be notified once a resolution is made.
                            </div>
                        )}
                    </>
                )}

                {/* Reject / Cancel Modal */}
                {cancelModalAction && (
                    <div style={{ marginTop: '24px', padding: '20px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px' }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#ef4444' }}>
                            {cancelModalAction === 'reject' ? 'Reject Order' : 'Cancel Order'}
                        </h4>
                        <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                            Please provide a reason for {cancelModalAction === 'reject' ? 'rejecting' : 'cancelling'} this order. This action cannot be undone.
                        </p>
                        <textarea className="ui-input" rows={3} placeholder="e.g. Item out of stock, unable to fulfill..."
                            value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                            style={{ width: '100%', resize: 'vertical', fontSize: '13px', marginBottom: '12px' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button className="ui-btn ghost" onClick={() => { setCancelModalAction(null); setCancelReason(''); }}>Back</button>
                            <button className="btn-reject" style={{ background: '#ef4444', color: '#fff', border: 'none' }} onClick={handleCancelOrderMarketplace} disabled={saving}>
                                {saving ? 'Processing...' : cancelModalAction === 'reject' ? 'Confirm Rejection' : 'Confirm Cancellation'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Audit History */}
                {dispatch.auditLog && dispatch.auditLog.length > 0 && (
                    <div style={{ marginTop: '32px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                        <h4 style={{ fontSize: '15px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Audit History</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {dispatch.auditLog.map((log, index) => (
                                <div key={index} style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{log.action}</span>
                                        <span style={{ color: 'var(--text-secondary)' }}>{formatMarketplaceDate(log.timestamp)}</span>
                                    </div>
                                    {log.reason && <div style={{ color: 'var(--text-secondary)' }}>Reason: <span style={{ color: 'var(--text-primary)' }}>{log.reason}</span></div>}
                                    <div style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '11px' }}>User: {log.user}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
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
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' }}>
                        {dispatch._source === 'marketplace' ? 'Order Details' : 'Dispatch Details'}
                    </h1>
                    <div style={{ color: '#94a3b8', fontSize: 14, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <span><strong style={{ color: '#e2e8f0' }}>ID:</strong> {dispatch.dispatchId || dispatch.id}</span>
                        {dispatch._source !== 'marketplace' && <span><strong style={{ color: '#e2e8f0' }}>Week:</strong> {formatDate(dispatch.weekStart)} - {formatDate(dispatch.weekEnd)}</span>}
                        <span><strong style={{ color: '#e2e8f0' }}>Restaurant:</strong> {dispatch.restaurantName}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {dispatch._source === 'marketplace' && isSuperAdmin && (
                        <button onClick={deleteOrder} style={{ background: 'transparent', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#ef4444', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                            🗑 Delete Order
                        </button>
                    )}
                    <div style={{ background: st.bg, color: st.color, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{st.icon}</span> {dispatch.status}
                    </div>
                </div>
            </div>

            {/* Workflow Progress (dispatch only) */}
            {dispatch._source !== 'marketplace' && <WorkflowProgress currentStatus={dispatch.status} />}

            {/* ── Marketplace vs Dispatch Content ── */}
            {dispatch._source === 'marketplace' ? renderMarketplaceOrder() : (
            <>
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
            {dispatch.cancellationReason && (
                <div style={{ background: 'rgba(251, 146, 60, 0.1)', padding: 16, borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #fb923c' }}>
                    <strong style={{ color: '#fb923c', fontSize: 13, textTransform: 'uppercase' }}>Cancellation Reason</strong>
                    <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 14 }}>{dispatch.cancellationReason}</div>
                    {dispatch.cancelledBy && <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>Cancelled by: {dispatch.cancelledBy}</div>}
                </div>
            )}
            {dispatch.partialReason && (
                <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: 16, borderRadius: 8, marginBottom: 24, borderLeft: '4px solid #f59e0b' }}>
                    <strong style={{ color: '#f59e0b', fontSize: 13, textTransform: 'uppercase' }}>Partial Confirmation Reason</strong>
                    <div style={{ marginTop: 4, color: '#e2e8f0', fontSize: 14 }}>{dispatch.partialReason}</div>
                </div>
            )}
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

            {/* Notes + Estimated Delivery */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
                <div>
                    <label style={{ display: 'block', marginBottom: 8, color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Vendor Notes</label>
                    <textarea className="ui-input" disabled={!canActionConfirm} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', minHeight: 80, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: 12, borderRadius: 8 }} placeholder="Add any notes regarding this dispatch..." />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: 8, color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>Estimated Delivery Time</label>
                    <input className="ui-input" disabled={!canActionConfirm} value={estimatedDelivery} onChange={(e) => setEstimatedDelivery(e.target.value)} style={{ width: '100%', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: 12, borderRadius: 8 }} placeholder="e.g. Monday 6:00 AM, Thursday 7:00 AM" />
                </div>
            </div>

            {/* Dispatch Actions */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 24 }}>
                {canActionConfirm && (<>
                    <button className="ui-btn ghost" onClick={() => setShowRejectModal(true)} disabled={saving} style={{ color: '#f43f5e', borderColor: 'transparent' }}>❌ Reject</button>
                    <button className="ui-btn ghost" onClick={openPartialModal} disabled={saving} style={{ color: '#f59e0b', borderColor: '#f59e0b' }}>⚠️ Partially Confirm</button>
                    <button className="ui-btn primary" onClick={handleConfirm} disabled={saving} style={{ background: '#10b981', color: '#fff', border: 'none' }}>{saving ? 'Saving...' : '✅ Confirm Dispatch'}</button>
                </>)}
                {canPack && <button className="ui-btn primary" onClick={handleMarkPacked} disabled={saving} style={{ background: '#6366f1', color: '#fff', border: 'none' }}>{saving ? 'Saving...' : '📦 Mark Packed'}</button>}
                {canOutForDelivery && <button className="ui-btn primary" onClick={handleMarkOutForDelivery} disabled={saving} style={{ background: '#0ea5e9', color: '#fff', border: 'none' }}>{saving ? 'Saving...' : '🚚 Out for Delivery'}</button>}
                {canActionMonDeliver && <button className="ui-btn primary" onClick={() => handleMarkDelivered('Monday')} disabled={saving} style={{ background: '#3b82f6', color: '#fff', border: 'none' }}>{saving ? 'Saving...' : '✓ Monday Delivered'}</button>}
                {canActionThuDeliver && <button className="ui-btn primary" onClick={() => handleMarkDelivered('Thursday')} disabled={saving} style={{ background: '#3b82f6', color: '#fff', border: 'none' }}>{saving ? 'Saving...' : '✓ Thursday Delivered'}</button>}
            </div>

            {/* Dispatch Reject Modal */}
            {showRejectModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#1e293b', padding: 24, borderRadius: 12, width: 400, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
                        <h2 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 600 }}>Reject Dispatch</h2>
                        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>Please provide a reason for rejecting this week's dispatch. This will alert the Global Supply Control Tower immediately.</p>
                        <textarea className="ui-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ width: '100%', minHeight: 100, marginBottom: 24, padding: 12, borderRadius: 8, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)' }} placeholder="Reason for rejection..." autoFocus />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button className="ui-btn ghost" onClick={() => setShowRejectModal(false)} disabled={saving}>Cancel</button>
                            <button className="ui-btn" onClick={submitReject} disabled={saving} style={{ background: '#f43f5e', color: '#fff', border: 'none' }}>{saving ? 'Submitting...' : 'Confirm Reject'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Dispatch Partial Modal */}
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
                                <thead><tr>
                                    <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Item</th>
                                    <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Available</th>
                                    <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Mon Qty</th>
                                    <th style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Thu Qty</th>
                                    <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Substitute</th>
                                    <th style={{ textAlign: 'left', color: '#94a3b8', fontSize: 12 }}>Reason / Note</th>
                                </tr></thead>
                                <tbody>
                                    {partialItems.map((item, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                            <td style={{ fontWeight: 500, padding: '10px 12px' }}><div>{item.itemName}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{item.packLabel}</div></td>
                                            <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                                                <input type="checkbox" checked={item.status !== 'unavailable'} onChange={(e) => { const copy = [...partialItems]; copy[idx].status = e.target.checked ? 'available' : 'unavailable'; if (!e.target.checked) { copy[idx].confirmedMondayQty = 0; copy[idx].confirmedThursdayQty = 0; } else { copy[idx].confirmedMondayQty = item.mondayQty || 0; copy[idx].confirmedThursdayQty = item.thursdayQty || 0; } setPartialItems(copy); }} style={{ transform: 'scale(1.2)', cursor: 'pointer' }} />
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 8px' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><span style={{ fontSize: 11, color: '#94a3b8' }}>{item.mondayQty || 0}→</span><input type="number" className="ui-input" style={{ width: 56, padding: 6, textAlign: 'center', background: 'rgba(0,0,0,0.5)' }} min="0" max={item.mondayQty || 0} value={item.confirmedMondayQty} disabled={item.status === 'unavailable'} onChange={(e) => { const copy = [...partialItems]; copy[idx].confirmedMondayQty = parseInt(e.target.value) || 0; setPartialItems(copy); }} /></div></td>
                                            <td style={{ textAlign: 'center', padding: '10px 8px' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><span style={{ fontSize: 11, color: '#94a3b8' }}>{item.thursdayQty || 0}→</span><input type="number" className="ui-input" style={{ width: 56, padding: 6, textAlign: 'center', background: 'rgba(0,0,0,0.5)' }} min="0" max={item.thursdayQty || 0} value={item.confirmedThursdayQty} disabled={item.status === 'unavailable'} onChange={(e) => { const copy = [...partialItems]; copy[idx].confirmedThursdayQty = parseInt(e.target.value) || 0; setPartialItems(copy); }} /></div></td>
                                            <td style={{ padding: '10px 8px' }}><input className="ui-input" style={{ width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.5)', fontSize: 12 }} placeholder="e.g. Roma tomatoes instead..." value={item.substituteText || ''} onChange={(e) => { const copy = [...partialItems]; copy[idx].substituteText = e.target.value; setPartialItems(copy); }} /></td>
                                            <td style={{ padding: '10px 8px' }}><input className="ui-input" style={{ width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.5)', fontSize: 12 }} placeholder="Reason..." value={item.vendorReason || item.note || ''} onChange={(e) => { const copy = [...partialItems]; copy[idx].vendorReason = e.target.value; copy[idx].note = e.target.value; setPartialItems(copy); }} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {partialItems.length > 0 && (() => {
                            const totalReq = partialItems.reduce((s, i) => s + (i.mondayQty || 0) + (i.thursdayQty || 0), 0);
                            const totalConf = partialItems.reduce((s, i) => s + (i.confirmedMondayQty || 0) + (i.confirmedThursdayQty || 0), 0);
                            const totalUnavail = totalReq - totalConf;
                            const withSubs = partialItems.filter(i => i.substituteText?.trim()).length;
                            return (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
                                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>{totalReq}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Requested</div></div>
                                    <div style={{ background: 'rgba(16,185,129,0.06)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{totalConf}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Confirmed</div></div>
                                    <div style={{ background: 'rgba(244,63,94,0.06)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 700, color: '#f43f5e' }}>{totalUnavail}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Unavailable</div></div>
                                    <div style={{ background: 'rgba(167,139,250,0.06)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 20, fontWeight: 700, color: '#a78bfa' }}>{withSubs}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>Substitutes</div></div>
                                </div>
                            );
                        })()}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button className="ui-btn ghost" onClick={() => setShowPartialModal(false)} disabled={saving}>Cancel</button>
                            <button className="ui-btn" onClick={submitPartial} disabled={saving} style={{ background: '#f59e0b', color: '#fff', border: 'none' }}>{saving ? 'Submitting...' : 'Submit Partial Confirmation'}</button>
                        </div>
                    </div>
                </div>
            )}
            </>
            )}
        </div>
    );
}
