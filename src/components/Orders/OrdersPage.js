import React, { useState, useEffect, useContext } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, deleteDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import { getTaxRate } from '../../constants/taxRates';
import './OrdersPage.css';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function OrdersPage() {
    const { isSuperAdmin, isAdmin, vendorId, permissions, displayName } = useContext(UserContext);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);

    // Editable Items State
    const [editableItems, setEditableItems] = useState([]);
    const [itemReasons, setItemReasons] = useState({});

    // Acceptance form state
    const [showAcceptForm, setShowAcceptForm] = useState(false);
    const [pickupDate, setPickupDate] = useState('');
    const [pickupTime, setPickupTime] = useState('');

    // Cancel/Reject modal state — cancelModalAction is 'reject' | 'cancel' | null
    const [cancelModalAction, setCancelModalAction] = useState(null);
    const [cancelReason, setCancelReason] = useState('');

    // Resolution state (superadmin in_review)
    const [resolutionItems, setResolutionItems] = useState([]);
    const [resolutionAction, setResolutionAction] = useState('');
    const [resolutionNotes, setResolutionNotes] = useState('');

    const canManageOrders = isSuperAdmin || isAdmin || (typeof permissions === 'object' && permissions?.canManageOrders);

    useEffect(() => {
        if (selectedOrder) {
            setShowAcceptForm(false);
            setPickupDate('');
            setPickupTime('');
            setCancelModalAction(null);
            setCancelReason('');
            setResolutionAction('');
            setResolutionNotes('');
            // Initialize editable items
            const clonedItems = JSON.parse(JSON.stringify(selectedOrder.items || []));
            setEditableItems(clonedItems);
            setResolutionItems(JSON.parse(JSON.stringify(clonedItems)));
            setItemReasons({});
        }
    }, [selectedOrder?.id]);

    // Filters
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const queryParams = new URLSearchParams(location.search);
    const initialSearch = queryParams.get('search') || '';

    const [searchTerm, setSearchTerm] = useState(initialSearch);
    const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'All');
    const [restaurantFilter, setRestaurantFilter] = useState('All');
    const [vendorFilter, setVendorFilter] = useState('All');

    useEffect(() => {
        const queryId = new URLSearchParams(location.search).get('orderId');
        const querySearch = new URLSearchParams(location.search).get('search');

        if (querySearch) {
            setSearchTerm(querySearch);
        }

        if (queryId && orders.length > 0) {
            const match = orders.find(o => o.id === queryId);
            if (match) {
                setSelectedOrder(match);
            }
        }
    }, [location.search, orders.length]);

    useEffect(() => {
        let q;
        const ordersRef = collection(db, 'marketplaceOrders');

        if (isSuperAdmin) {
            // Superadmin sees all orders
            q = query(ordersRef, orderBy('createdAt', 'desc'));
        } else if (vendorId) {
            // Vendor sees only their orders
            q = query(ordersRef, where('vendorId', '==', vendorId), orderBy('createdAt', 'desc'));
        } else {
            setLoading(false);
            return;
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setOrders(data);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching orders:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [isSuperAdmin, vendorId]);

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString();
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
    };

    const updateOrderStatus = async (orderId, newStatus) => {
        try {
            const orderRef = doc(db, 'marketplaceOrders', orderId);
            await updateDoc(orderRef, { status: newStatus });
            toast.success(`Order status updated to ${newStatus.replace(/_/g, ' ')}`);
            setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
        } catch (error) {
            console.error("Error updating order status:", error);
            toast.error("Failed to update order status");
        }
    };

    const handleConfirmAccept = async () => {
        if (!pickupDate || !pickupTime) {
            toast.warn("Please select both a pickup date and time.");
            return;
        }

        // Validate reasons for modified quantities
        const auditLogEntries = [];
        let hasMissingReason = false;

        editableItems.forEach((item, index) => {
            const originalItem = selectedOrder.items[index];
            if (item.qty < originalItem.qty) {
                const reason = itemReasons[index]?.trim();
                if (!reason) {
                    hasMissingReason = true;
                } else {
                    const actionName = item.qty === 0 ? "rejected" : "quantity reduced";
                    auditLogEntries.push({
                        action: `Item "${item.name}" ${actionName} from ${originalItem.qty} to ${item.qty}`,
                        reason: reason,
                        timestamp: new Date().toISOString(),
                        user: displayName || 'Admin'
                    });
                }
            }
        });

        if (hasMissingReason) {
            toast.warn("Please provide a reason for all reduced or rejected items.");
            return;
        }

        // Calculate new totals (Snapshot logic)
        let subtotalBeforeTax = 0;
        let totalTax = 0;
        const taxRate = selectedOrder.taxRate || 0;

        editableItems.forEach(item => {
            const lineSubtotal = round2((item.vendorPrice ?? item.price ?? 0) * item.qty);
            item.lineSubtotal = lineSubtotal; // Update line snapshot
            subtotalBeforeTax += lineSubtotal;
            // Only apply tax to taxable items
            if (item.taxable) {
                totalTax += round2(lineSubtotal * taxRate);
            }
        });

        subtotalBeforeTax = round2(subtotalBeforeTax);
        totalTax = round2(totalTax);
        const grandTotalAfterTax = round2(subtotalBeforeTax + totalTax);

        try {
            const hasModifications = auditLogEntries.length > 0;
            const newStatus = hasModifications ? 'pending_customer_approval' : 'pending_fulfillment';

            const orderRef = doc(db, 'marketplaceOrders', selectedOrder.id);
            const updatePayload = {
                status: newStatus,
                pickupDate,
                pickupTime,
                items: editableItems,
                subtotalBeforeTax,
                totalTax,
                grandTotalAfterTax,
                // Keep legacy total for backward compatibility
                total: grandTotalAfterTax
            };

            // Only append audit log if there are changes
            if (hasModifications) {
                const updatedAuditLog = [...(selectedOrder.auditLog || []), ...auditLogEntries];
                updatePayload.auditLog = updatedAuditLog;
            }

            await updateDoc(orderRef, updatePayload);
            toast.success(hasModifications ? 'Changes submitted for customer approval!' : 'Order accepted with scheduled pickup!');

            setSelectedOrder(prev => prev ? {
                ...prev,
                ...updatePayload
            } : null);
            setShowAcceptForm(false);
        } catch (error) {
            console.error("Error accepting order:", error);
            toast.error("Failed to accept order");
        }
    };

    const handleCancelOrder = async () => {
        if (!cancelReason.trim()) {
            toast.warn(`Please provide a reason for ${cancelModalAction === 'reject' ? 'rejection' : 'cancellation'}.`);
            return;
        }

        const actionLabel = cancelModalAction === 'reject' ? 'Order rejected by vendor' : 'Order cancelled by vendor';

        try {
            const orderRef = doc(db, 'marketplaceOrders', selectedOrder.id);
            const auditEntry = {
                action: actionLabel,
                reason: cancelReason.trim(),
                timestamp: new Date().toISOString(),
                user: displayName || 'Vendor'
            };
            const updatedAuditLog = [...(selectedOrder.auditLog || []), auditEntry];

            const updatePayload = {
                status: 'cancelled_by_vendor',
                auditLog: updatedAuditLog,
                cancelledAt: new Date().toISOString(),
                cancelReason: cancelReason.trim()
            };

            await updateDoc(orderRef, updatePayload);

            toast.success('Order has been cancelled.');
            setSelectedOrder(prev => prev ? { ...prev, status: 'cancelled_by_vendor', auditLog: updatedAuditLog } : null);
            setCancelModalAction(null);
            setCancelReason('');
        } catch (error) {
            console.error('Error cancelling order:', error);
            toast.error('Failed to cancel order');
        }
    };

    // Mark as Delivered → delivered_awaiting_confirmation
    const handleMarkDelivered = async () => {
        try {
            const orderRef = doc(db, 'marketplaceOrders', selectedOrder.id);
            const now = new Date();
            const reviewWindowEndsAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
            const auditEntry = {
                action: 'Order marked as delivered — awaiting restaurant confirmation',
                reason: 'Delivery completed',
                timestamp: now.toISOString(),
                user: displayName || 'Vendor'
            };
            const updatedAuditLog = [...(selectedOrder.auditLog || []), auditEntry];

            await updateDoc(orderRef, {
                status: 'delivered_awaiting_confirmation',
                deliveredAt: now.toISOString(),
                reviewWindowEndsAt,
                auditLog: updatedAuditLog
            });

            toast.success('Order marked as delivered. Awaiting restaurant confirmation.');
            setSelectedOrder(prev => prev ? {
                ...prev,
                status: 'delivered_awaiting_confirmation',
                deliveredAt: now.toISOString(),
                reviewWindowEndsAt,
                auditLog: updatedAuditLog
            } : null);
        } catch (error) {
            console.error('Error marking delivered:', error);
            toast.error('Failed to mark as delivered');
        }
    };

    // SuperAdmin: Resolve issue → fulfilled
    const handleResolveIssue = async () => {
        if (!resolutionAction) {
            toast.warn('Please select a resolution action.');
            return;
        }

        try {
            const orderRef = doc(db, 'marketplaceOrders', selectedOrder.id);

            // Recalculate totals from resolution items
            let subtotalBeforeTax = 0;
            let totalTax = 0;
            const taxRate = selectedOrder.taxRate || 0;
            resolutionItems.forEach(item => {
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

            const now = new Date();

            // Build granular per-item audit entries for any changes
            const originalItems = selectedOrder.items || [];
            const itemAuditEntries = [];
            resolutionItems.forEach((item, idx) => {
                const orig = originalItems[idx];
                if (!orig) return;

                const origQty = orig.qty || 0;
                const newQty = item.qty || 0;
                const origPrice = Number(orig.vendorPrice ?? orig.price ?? 0);
                const newPrice = Number(item.vendorPrice ?? item.price ?? 0);
                const itemName = item.name || item.itemName || 'Unknown Item';

                if (newQty === 0 && origQty > 0) {
                    itemAuditEntries.push({
                        action: `Item "${itemName}" removed (qty ${origQty} → 0)`,
                        timestamp: now.toISOString(),
                        user: displayName || 'SuperAdmin'
                    });
                } else if (newQty !== origQty) {
                    itemAuditEntries.push({
                        action: `Item "${itemName}" qty adjusted from ${origQty} to ${newQty}`,
                        timestamp: now.toISOString(),
                        user: displayName || 'SuperAdmin'
                    });
                }

                if (newPrice !== origPrice && newQty > 0) {
                    itemAuditEntries.push({
                        action: `Item "${itemName}" price adjusted from $${origPrice.toFixed(2)} to $${newPrice.toFixed(2)}`,
                        timestamp: now.toISOString(),
                        user: displayName || 'SuperAdmin'
                    });
                }
            });

            // Summary audit entry
            const resolutionEntry = {
                action: `Issue resolved — ${resolutionAction.replace(/_/g, ' ')}`,
                reason: resolutionNotes || 'Resolved by admin',
                timestamp: now.toISOString(),
                user: displayName || 'SuperAdmin'
            };

            // Combine: item-level changes first, then the resolution summary
            const updatedAuditLog = [...(selectedOrder.auditLog || []), ...itemAuditEntries, resolutionEntry];

            await updateDoc(orderRef, {
                status: 'fulfilled',
                issueStatus: 'resolved',
                resolutionAction: {
                    type: resolutionAction,
                    details: resolutionNotes,
                    resolvedBy: displayName || 'SuperAdmin',
                    resolvedAt: now.toISOString()
                },
                resolvedAt: now.toISOString(),
                items: resolutionItems,
                subtotalBeforeTax,
                totalTax,
                grandTotalAfterTax,
                total: grandTotalAfterTax,
                auditLog: updatedAuditLog
            });

            toast.success('Issue resolved. Order finalized and invoice will be generated.');

            // ── Sync existing invoices with recalculated totals ──
            try {
                // Fetch vendor info for tax rate (needed for per-item invoice formatting)
                const vendorSnap = await getDoc(doc(db, 'vendors', selectedOrder.vendorId));
                const vData = vendorSnap.exists() ? vendorSnap.data() : {};
                const invoiceTaxRate = getTaxRate(vData.country || 'Canada', vData.province);
                const vendorCommissionPercent = Number(vData.commissionPercent ?? 10);

                // Build formatted items for invoices
                let invSubtotal = 0;
                let invTotalTax = 0;
                const invoiceItems = resolutionItems.map(item => {
                    const price = Number(item.vendorPrice ?? item.price ?? 0);
                    const qty = item.qty || 1;
                    const lineTotal = item.lineSubtotal || round2(price * qty);
                    const isTaxable = !!item.taxable;
                    const lineTax = isTaxable ? round2(lineTotal * (invoiceTaxRate / 100)) : 0;
                    invSubtotal += lineTotal;
                    invTotalTax += lineTax;
                    return {
                        itemId: item.itemId,
                        itemName: item.itemName || item.name || 'Unknown Item',
                        unit: item.unit || 'unit',
                        qty,
                        price,
                        vendorPrice: price,
                        lineTotal,
                        lineTotalVendor: lineTotal,
                        isTaxable,
                        lineTax
                    };
                });
                invSubtotal = round2(invSubtotal);
                invTotalTax = round2(invTotalTax);
                const invGrandTotal = round2(invSubtotal + invTotalTax);

                // Update Restaurant Invoice (uses orderId as doc ID)
                const restInvRef = doc(db, 'restaurantInvoices', selectedOrder.id);
                const restInvSnap = await getDoc(restInvRef);
                if (restInvSnap.exists()) {
                    await updateDoc(restInvRef, {
                        items: invoiceItems,
                        subtotal: invSubtotal,
                        totalTax: invTotalTax,
                        grandTotal: invGrandTotal,
                        updatedAt: serverTimestamp(),
                        adminNotes: 'Updated after issue resolution'
                    });
                }

                // Update Vendor Invoice (uses orderId as doc ID)
                const vendorInvRef = doc(db, 'vendorInvoices', selectedOrder.id);
                const vendorInvSnap = await getDoc(vendorInvRef);
                if (vendorInvSnap.exists()) {
                    const commissionAmount = round2(invSubtotal * (vendorCommissionPercent / 100));
                    const netVendorPayable = round2(invSubtotal - commissionAmount);
                    await updateDoc(vendorInvRef, {
                        items: invoiceItems,
                        subtotalVendorAmount: invSubtotal,
                        grossVendorAmount: invSubtotal,
                        totalTaxAmount: invTotalTax,
                        totalVendorAmount: invGrandTotal,
                        commissionAmount,
                        netVendorPayable,
                        updatedAt: serverTimestamp(),
                        adminNotes: 'Updated after issue resolution'
                    });
                }
            } catch (invoiceErr) {
                console.error('Failed to sync invoices after resolution:', invoiceErr);
                // Don't block the resolution — invoices can be manually regenerated
            }

            setSelectedOrder(prev => prev ? {
                ...prev,
                status: 'fulfilled',
                issueStatus: 'resolved',
                resolvedAt: now.toISOString(),
                items: resolutionItems,
                subtotalBeforeTax,
                totalTax,
                grandTotalAfterTax,
                total: grandTotalAfterTax,
                auditLog: updatedAuditLog
            } : null);
            setResolutionAction('');
            setResolutionNotes('');
        } catch (error) {
            console.error('Error resolving issue:', error);
            toast.error('Failed to resolve issue');
        }
    };

    // Review window countdown helper
    const getReviewWindowStatus = (order) => {
        if (!order.reviewWindowEndsAt) return null;
        const endsAt = new Date(order.reviewWindowEndsAt);
        const now = new Date();
        const diff = endsAt - now;
        if (diff <= 0) return { expired: true, text: 'Review window has expired' };
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return { expired: false, text: `${hours}h ${minutes}m remaining` };
    };

    const deleteOrder = async (orderId) => {
        if (!window.confirm("Are you sure you want to delete this order? This action cannot be undone.")) {
            return;
        }

        try {
            const orderRef = doc(db, 'marketplaceOrders', orderId);
            await deleteDoc(orderRef);
            toast.success("Order deleted successfully");
            if (selectedOrder?.id === orderId) {
                setSelectedOrder(null);
            }
        } catch (error) {
            console.error("Error deleting order:", error);
            toast.error("Failed to delete order");
        }
    };

    // Derived unique values for filters
    const uniqueRestaurants = [...new Set(orders.map(o => o.restaurantId).filter(Boolean))].sort();
    const uniqueVendors = [...new Set(orders.map(o => o.vendorName).filter(Boolean))].sort();

    // Filter logic
    const filteredOrders = orders.filter(order => {
        const searchLower = searchTerm.toLowerCase();
        const orderIdMatch = (order.orderGroupId || '').toLowerCase().includes(searchLower) ||
            (order.id || '').toLowerCase().includes(searchLower);

        let statusMatch = false;
        if (statusFilter === 'All') {
            statusMatch = true;
        } else if (statusFilter.includes(',')) {
            const allowedStatuses = statusFilter.split(',').map(s => s.trim());
            statusMatch = allowedStatuses.includes(order.status);
        } else {
            statusMatch = order.status === statusFilter;
        }

        const restMatch = restaurantFilter === 'All' || order.restaurantId === restaurantFilter;
        const vendorMatch = vendorFilter === 'All' || order.vendorName === vendorFilter;

        return orderIdMatch && statusMatch && restMatch && (isSuperAdmin ? vendorMatch : true);
    });

    if (loading) {
        return (
            <div className="orders-page">
                <div className="page-header">
                    <div>
                        <h1>Orders</h1>
                        <p className="subtitle">Loading marketplace orders...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="orders-page">
            <div className="page-header">
                <div>
                    <h1>Orders</h1>
                    <p className="subtitle">Manage {isSuperAdmin ? 'all marketplace' : 'your'} orders</p>
                </div>
            </div>

            {/* Filters Section */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    className="ui-input"
                    placeholder="🔍 Search Order ID..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ maxWidth: 200 }}
                />
                <select
                    className="ui-input"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    style={{ maxWidth: 200 }}
                >
                    <option value="All">All Statuses</option>
                    {statusFilter.includes(',') && <option value={statusFilter}>Custom Filter</option>}
                    <option value="pending_confirmation">Pending Confirmation</option>
                    <option value="pending_customer_approval">Pending Customer Approval</option>
                    <option value="pending_fulfillment">Pending Fulfillment</option>
                    <option value="delivery_in_route">Delivery in Route</option>
                    <option value="delivered_awaiting_confirmation">Delivered - Awaiting Confirmation</option>
                    <option value="in_review">In Review</option>
                    <option value="fulfilled">Fulfilled</option>
                    <option value="rejected">Rejected</option>
                    <option value="cancelled_by_vendor">Cancelled by Vendor</option>
                    <option value="cancelled_by_customer">Cancelled by Customer</option>
                </select>
                <select
                    className="ui-input"
                    value={restaurantFilter}
                    onChange={e => setRestaurantFilter(e.target.value)}
                    style={{ maxWidth: 200 }}
                >
                    <option value="All">All Restaurants</option>
                    {uniqueRestaurants.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {isSuperAdmin && (
                    <select
                        className="ui-input"
                        value={vendorFilter}
                        onChange={e => setVendorFilter(e.target.value)}
                        style={{ maxWidth: 200 }}
                    >
                        <option value="All">All Vendors</option>
                        {uniqueVendors.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                )}
            </div>

            <div className="orders-list-container">
                <div className="orders-table-wrapper">
                    <table className="orders-table">
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Date</th>
                                {isSuperAdmin && <th>Vendor</th>}
                                <th>Restaurant</th>
                                <th>Status</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrders.length === 0 ? (
                                <tr>
                                    <td colSpan={isSuperAdmin ? 6 : 5} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                                        {orders.length === 0 ? 'No orders found' : 'No orders match your filters'}
                                    </td>
                                </tr>
                            ) : (
                                filteredOrders.map(order => (
                                    <tr key={order.id} onClick={() => setSelectedOrder(order)}>
                                        <td style={{ fontFamily: 'monospace' }}>{order.orderGroupId || order.id.slice(-8).toUpperCase()}</td>
                                        <td>{formatDate(order.createdAt)}</td>
                                        {isSuperAdmin && <td>{order.vendorName}</td>}
                                        <td>{order.restaurantId}</td>
                                        <td>
                                            <span className={`status-badge ${order.status?.toLowerCase()}`}>
                                                {order.status?.replace(/_/g, ' ') || 'unknown'}
                                            </span>
                                        </td>
                                        <td style={{ fontWeight: 600 }}>{formatCurrency(order.total)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Order Details Modal */}
            {selectedOrder && (
                <div className="order-modal-overlay" onClick={() => setSelectedOrder(null)}>
                    <div className="order-modal" onClick={e => e.stopPropagation()}>
                        <div className="order-modal-header">
                            <h2>Order Details</h2>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                {isSuperAdmin && (
                                    <button
                                        onClick={() => deleteOrder(selectedOrder.id)}
                                        style={{
                                            background: 'transparent',
                                            border: '1px solid rgba(239, 68, 68, 0.5)',
                                            color: '#ef4444',
                                            padding: '4px 12px',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '13px'
                                        }}
                                    >
                                        Delete Order
                                    </button>
                                )}
                                <button className="close-modal-btn" onClick={() => setSelectedOrder(null)}>&times;</button>
                            </div>
                        </div>
                        <div className="order-modal-body">
                            <div className="order-info-grid">
                                <div className="info-item">
                                    <span className="info-label">Order ID</span>
                                    <span className="info-value" style={{ fontFamily: 'monospace' }}>{selectedOrder.orderGroupId || selectedOrder.id.slice(-8).toUpperCase()}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Date</span>
                                    <span className="info-value">{formatDate(selectedOrder.createdAt)}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Restaurant</span>
                                    <span className="info-value">{selectedOrder.restaurantId}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Status</span>
                                    <span className="info-value">
                                        <span className={`status-badge ${selectedOrder.status?.toLowerCase()}`}>
                                            {selectedOrder.status?.replace(/_/g, ' ') || 'unknown'}
                                        </span>
                                    </span>
                                </div>
                                {isSuperAdmin && (
                                    <div className="info-item">
                                        <span className="info-label">Vendor</span>
                                        <span className="info-value">{selectedOrder.vendorName}</span>
                                    </div>
                                )}
                                {selectedOrder.pickupDate && selectedOrder.pickupTime && (
                                    <div className="info-item">
                                        <span className="info-label">Pickup Schedule</span>
                                        <span className="info-value" style={{ color: '#4ade80', fontWeight: 600 }}>
                                            {selectedOrder.pickupDate} at {selectedOrder.pickupTime}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <h3 style={{ fontSize: '16px', marginBottom: '12px', marginTop: '32px' }}>Items</h3>
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
                                    {(() => {
                                        const isEditable = selectedOrder.status === 'pending_confirmation' && canManageOrders;
                                        const displayItems = isEditable ? editableItems : (selectedOrder.items || []);
                                        return displayItems.map((item, idx) => {
                                            const originalItem = selectedOrder.items?.[idx] || item;
                                            const isModified = isEditable && item.qty < originalItem.qty;

                                            return (
                                                <React.Fragment key={idx}>
                                                    <tr style={{ opacity: item.qty === 0 ? 0.5 : 1 }}>
                                                        <td className="item-name-cell">
                                                            {item.imageUrl && (
                                                                <img src={item.imageUrl} alt={item.name} className="item-thumbnail" />
                                                            )}
                                                            <div>
                                                                <div style={{ fontWeight: 500, textDecoration: item.qty === 0 ? 'line-through' : 'none' }}>{item.name}</div>
                                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                    {item.brand && `${item.brand} • `}{item.unit}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td>{formatCurrency(item.price)}</td>
                                                        <td>
                                                            {isEditable ? (
                                                                <input
                                                                    type="number"
                                                                    className="ui-input"
                                                                    style={{ width: '70px', padding: '4px 8px' }}
                                                                    min="0"
                                                                    max={originalItem.qty}
                                                                    value={item.qty}
                                                                    onChange={(e) => {
                                                                        const val = parseInt(e.target.value) || 0;
                                                                        const newQty = Math.max(0, Math.min(originalItem.qty, val));
                                                                        const newItems = [...editableItems];
                                                                        newItems[idx].qty = newQty;
                                                                        setEditableItems(newItems);
                                                                    }}
                                                                />
                                                            ) : (
                                                                item.qty
                                                            )}
                                                        </td>
                                                        <td>{formatCurrency(item.price * item.qty)}</td>
                                                    </tr>
                                                    {isModified && isEditable && (
                                                        <tr>
                                                            <td colSpan="4" style={{ paddingTop: 0, paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(239, 68, 68, 0.05)', padding: '8px 12px', borderRadius: '6px', borderLeft: '3px solid #ef4444' }}>
                                                                    <span style={{ fontSize: '13px', color: '#ef4444' }}>Reason for {item.qty === 0 ? 'rejection' : 'reduction'}:</span>
                                                                    <input
                                                                        type="text"
                                                                        className="ui-input"
                                                                        style={{ flex: 1, padding: '4px 8px', fontSize: '13px' }}
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
                                        })
                                    })()}
                                </tbody>
                            </table>

                            <div className="order-summary">
                                <div className="summary-row">
                                    <span>Subtotal</span>
                                    <span>{formatCurrency(selectedOrder.subtotalBeforeTax || selectedOrder.subtotal || editableItems.reduce((sum, item) => sum + (item.price * item.qty), 0))}</span>
                                </div>
                                <div className="summary-row">
                                    <span>Tax ({((selectedOrder.taxRate || 0) * 100).toFixed(0)}%)</span>
                                    <span>{formatCurrency(selectedOrder.totalTax || selectedOrder.taxTotal || 0)}</span>
                                </div>
                                <div className="summary-row total">
                                    <span>Total</span>
                                    <span>{formatCurrency(selectedOrder.grandTotalAfterTax || selectedOrder.total || 0)}</span>
                                </div>

                                {selectedOrder.taxIntegrityStatus === 'MISMATCH' && (
                                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', fontSize: '12px', color: '#ef4444' }}>
                                        ⚠️ <strong>Tax Mismatch:</strong> The stored total does not match calculated line items.
                                    </div>
                                )}
                            </div>

                            {selectedOrder.status === 'pending_confirmation' && canManageOrders && (
                                <div className="order-actions">
                                    {showAcceptForm ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', padding: '16px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px' }}>
                                            <h4 style={{ margin: 0, fontSize: '15px' }}>Confirm Pickup Details</h4>
                                            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label className="ui-label">Ready Date</label>
                                                    <input
                                                        type="date"
                                                        className="ui-input"
                                                        value={pickupDate}
                                                        min={new Date().toISOString().split('T')[0]}
                                                        onChange={e => setPickupDate(e.target.value)}
                                                    />
                                                </div>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label className="ui-label">Ready Time</label>
                                                    <input
                                                        type="time"
                                                        className="ui-input"
                                                        value={pickupTime}
                                                        onChange={e => setPickupTime(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                <button
                                                    className="ui-btn primary"
                                                    onClick={handleConfirmAccept}
                                                    disabled={!pickupDate || !pickupTime}
                                                >
                                                    {editableItems.some((item, idx) => item.qty < (selectedOrder.items[idx]?.qty || item.qty))
                                                        ? 'Submit Changes for Approval'
                                                        : 'Confirm & Accept'}
                                                </button>
                                                <button
                                                    className="ui-btn ghost"
                                                    onClick={() => setShowAcceptForm(false)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <button
                                                className="btn-reject"
                                                onClick={() => setCancelModalAction('reject')}
                                            >
                                                ✗ Reject Order
                                            </button>
                                            <button
                                                className="btn-accept"
                                                onClick={() => setShowAcceptForm(true)}
                                            >
                                                ✓ Accept Order
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}

                            {selectedOrder.status === 'pending_fulfillment' && canManageOrders && (
                                <div className="order-actions">
                                    <button
                                        className="btn-reject"
                                        onClick={() => setCancelModalAction('cancel')}
                                    >
                                        ✗ Cancel Order
                                    </button>
                                    <button
                                        className="btn-accept"
                                        style={{ flex: 1 }}
                                        onClick={() => updateOrderStatus(selectedOrder.id, 'delivery_in_route')}
                                    >
                                        🚚 Mark as Picked Up / In Route
                                    </button>
                                </div>
                            )}

                            {selectedOrder.status === 'delivery_in_route' && canManageOrders && (
                                <div className="order-actions">
                                    <button
                                        className="btn-reject"
                                        onClick={() => setCancelModalAction('cancel')}
                                    >
                                        ✗ Cancel Order
                                    </button>
                                    <button
                                        className="btn-accept"
                                        style={{ flex: 1 }}
                                        onClick={handleMarkDelivered}
                                    >
                                        📦 Mark as Delivered
                                    </button>
                                </div>
                            )}

                            {/* Review Window Banner — delivered_awaiting_confirmation */}
                            {selectedOrder.status === 'delivered_awaiting_confirmation' && (() => {
                                const windowStatus = getReviewWindowStatus(selectedOrder);
                                return (
                                    <>
                                        <div className="review-window-banner">
                                            <span className="banner-icon">⏳</span>
                                            <div className="banner-text">
                                                <strong>Awaiting Restaurant Confirmation</strong>
                                                <span>
                                                    {windowStatus?.expired
                                                        ? 'Review window has expired — awaiting auto-confirmation'
                                                        : `Review window: ${windowStatus?.text}`}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="invoice-blocked-badge">
                                            🚫 Invoice generation blocked until confirmation
                                        </div>
                                    </>
                                );
                            })()}

                            {/* Issue Raised Banner — in_review */}
                            {selectedOrder.status === 'in_review' && (
                                <>
                                    <div className="issue-banner">
                                        <h4>⚠️ Issue Reported by Restaurant</h4>
                                        <div style={{ marginBottom: '6px' }}>
                                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                {selectedOrder.issueReport?.type || 'Issue'}
                                            </span>
                                        </div>
                                        <div style={{ color: 'var(--text-primary)' }}>
                                            {selectedOrder.issueReport?.notes || selectedOrder.issueDetails?.description || 'No details provided'}
                                        </div>
                                        {selectedOrder.issueReport?.items?.length > 0 && (
                                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(249, 115, 22, 0.2)' }}>
                                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Affected Items:</span>
                                                {selectedOrder.issueReport.items.map((item, idx) => (
                                                    <div key={idx} style={{ fontSize: '13px', color: 'var(--text-primary)', padding: '2px 0' }}>
                                                        • <strong>{item.name}</strong> (x{item.qty}){item.notes ? ` — "${item.notes}"` : ''}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="issue-meta">
                                            <span>Reported by: {selectedOrder.issueReport?.reportedBy || selectedOrder.issueDetails?.reportedBy || 'Restaurant'}</span>
                                            <span>Date: {formatDate(selectedOrder.issueReport?.reportedAt || selectedOrder.issueDetails?.reportedAt)}</span>
                                        </div>
                                    </div>
                                    <div className="invoice-blocked-badge">
                                        🚫 Invoice generation blocked — issue under review
                                    </div>

                                    {/* SuperAdmin Resolution Panel */}
                                    {isSuperAdmin && (
                                        <div className="resolution-panel">
                                            <h4>🔧 Resolve Issue</h4>

                                            <div className="resolution-actions">
                                                {['update_quantity', 'void_item', 'approve_partial', 'reject_claim'].map(action => (
                                                    <button
                                                        key={action}
                                                        className={`resolution-action-btn ${resolutionAction === action ? 'active' : ''}`}
                                                        onClick={() => setResolutionAction(action)}
                                                    >
                                                        {action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                                    </button>
                                                ))}
                                            </div>

                                            {resolutionAction && resolutionAction !== 'reject_claim' && (
                                                <>
                                                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                                                        Adjust item quantities below. Voided items should be set to 0.
                                                    </p>
                                                    <table className="order-items-table" style={{ marginBottom: '16px' }}>
                                                        <thead>
                                                            <tr>
                                                                <th>Item</th>
                                                                <th>Original Qty</th>
                                                                <th>Adjusted Qty</th>
                                                                <th>Total</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {resolutionItems.map((item, idx) => (
                                                                <tr key={idx} style={{ opacity: item.qty === 0 ? 0.5 : 1 }}>
                                                                    <td>{item.name}</td>
                                                                    <td>{selectedOrder.items?.[idx]?.qty || item.qty}</td>
                                                                    <td>
                                                                        <input
                                                                            type="number"
                                                                            className="ui-input"
                                                                            style={{ width: '70px', padding: '4px 8px' }}
                                                                            min="0"
                                                                            value={item.qty}
                                                                            onChange={(e) => {
                                                                                const val = Math.max(0, parseInt(e.target.value) || 0);
                                                                                const updated = [...resolutionItems];
                                                                                updated[idx].qty = val;
                                                                                setResolutionItems(updated);
                                                                            }}
                                                                        />
                                                                    </td>
                                                                    <td>{formatCurrency((item.vendorPrice ?? item.price ?? 0) * item.qty)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </>
                                            )}

                                            <textarea
                                                className="ui-input"
                                                rows={2}
                                                placeholder="Resolution notes..."
                                                value={resolutionNotes}
                                                onChange={e => setResolutionNotes(e.target.value)}
                                                style={{ width: '100%', resize: 'vertical', fontSize: '13px', marginBottom: '12px' }}
                                            />

                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                <button
                                                    className="btn-accept"
                                                    onClick={handleResolveIssue}
                                                    disabled={!resolutionAction}
                                                >
                                                    ✅ Approve & Finalize Order
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Vendor view of in_review — read-only */}
                                    {!isSuperAdmin && canManageOrders && (
                                        <div style={{ marginTop: '16px', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            This order is under review by the admin team. You will be notified once a resolution is made.
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Reject / Cancel Order Modal */}
                            {cancelModalAction && (
                                <div style={{ marginTop: '24px', padding: '20px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px' }}>
                                    <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#ef4444' }}>
                                        {cancelModalAction === 'reject' ? 'Reject Order' : 'Cancel Order'}
                                    </h4>
                                    <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        Please provide a reason for {cancelModalAction === 'reject' ? 'rejecting' : 'cancelling'} this order. This action cannot be undone.
                                    </p>
                                    <textarea
                                        className="ui-input"
                                        rows={3}
                                        placeholder="e.g. Item out of stock, unable to fulfill..."
                                        value={cancelReason}
                                        onChange={e => setCancelReason(e.target.value)}
                                        style={{ width: '100%', resize: 'vertical', fontSize: '13px', marginBottom: '12px' }}
                                    />
                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        <button
                                            className="ui-btn ghost"
                                            onClick={() => { setCancelModalAction(null); setCancelReason(''); }}
                                        >
                                            Back
                                        </button>
                                        <button
                                            className="btn-reject"
                                            style={{ background: '#ef4444', color: '#fff', border: 'none' }}
                                            onClick={handleCancelOrder}
                                        >
                                            {cancelModalAction === 'reject' ? 'Confirm Rejection' : 'Confirm Cancellation'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Audit History UI */}
                            {selectedOrder.auditLog && selectedOrder.auditLog.length > 0 && (
                                <div style={{ marginTop: '32px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                                    <h4 style={{ fontSize: '15px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Audit History</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {selectedOrder.auditLog.map((log, index) => (
                                            <div key={index} style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{log.action}</span>
                                                    <span style={{ color: 'var(--text-secondary)' }}>{formatDate(log.timestamp)}</span>
                                                </div>
                                                <div style={{ color: 'var(--text-secondary)' }}>
                                                    Reason: <span style={{ color: 'var(--text-primary)' }}>{log.reason}</span>
                                                </div>
                                                <div style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '11px' }}>
                                                    User: {log.user}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
