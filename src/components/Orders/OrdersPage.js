import React, { useState, useEffect, useContext } from 'react';
import { db } from '../../firebase';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import './OrdersPage.css';

export default function OrdersPage() {
    const { isSuperAdmin, isAdmin, vendorId, permissions } = useContext(UserContext);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);

    // Acceptance form state
    const [showAcceptForm, setShowAcceptForm] = useState(false);
    const [pickupDate, setPickupDate] = useState('');
    const [pickupTime, setPickupTime] = useState('');

    const canManageOrders = isSuperAdmin || isAdmin || (typeof permissions === 'object' && permissions?.canManageOrders);

    useEffect(() => {
        if (selectedOrder) {
            setShowAcceptForm(false);
            setPickupDate('');
            setPickupTime('');
        }
    }, [selectedOrder?.id]);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [restaurantFilter, setRestaurantFilter] = useState('All');
    const [vendorFilter, setVendorFilter] = useState('All');

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

        try {
            const orderRef = doc(db, 'marketplaceOrders', selectedOrder.id);
            await updateDoc(orderRef, {
                status: 'pending_fulfillment',
                pickupDate,
                pickupTime
            });
            toast.success('Order accepted with pickup scheduled!');
            setSelectedOrder(prev => prev ? { ...prev, status: 'pending_fulfillment', pickupDate, pickupTime } : null);
            setShowAcceptForm(false);
        } catch (error) {
            console.error("Error accepting order:", error);
            toast.error("Failed to accept order");
        }
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
        const orderIdMatch = (order.orderGroupId || order.id || '').toLowerCase().includes(searchTerm.toLowerCase());
        const statusMatch = statusFilter === 'All' || order.status === statusFilter;
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
                    <option value="pending_confirmation">Pending Confirmation</option>
                    <option value="pending_fulfillment">Pending Fulfillment</option>
                    <option value="delivery_in_route">Delivery In Route</option>
                    <option value="fulfilled">Fulfilled</option>
                    <option value="rejected">Rejected</option>
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
                                        <td style={{ fontFamily: 'monospace' }}>{order.orderGroupId || order.id.slice(0, 8)}</td>
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
                                    <span className="info-value" style={{ fontFamily: 'monospace' }}>{selectedOrder.orderGroupId || selectedOrder.id}</span>
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
                                    {(selectedOrder.items || []).map((item, idx) => (
                                        <tr key={idx}>
                                            <td className="item-name-cell">
                                                {item.imageUrl && (
                                                    <img src={item.imageUrl} alt={item.name} className="item-thumbnail" />
                                                )}
                                                <div>
                                                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                        {item.brand && `${item.brand} • `}{item.unit}
                                                    </div>
                                                </div>
                                            </td>
                                            <td>{formatCurrency(item.price)}</td>
                                            <td>{item.qty}</td>
                                            <td>{formatCurrency(item.price * item.qty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="order-summary">
                                <div className="summary-row">
                                    <span>Subtotal</span>
                                    <span>{formatCurrency(selectedOrder.subtotal)}</span>
                                </div>
                                <div className="summary-row">
                                    <span>Tax ({((selectedOrder.taxRate || 0) * 100).toFixed(0)}%)</span>
                                    <span>{formatCurrency(selectedOrder.taxTotal)}</span>
                                </div>
                                <div className="summary-row total">
                                    <span>Total</span>
                                    <span>{formatCurrency(selectedOrder.total)}</span>
                                </div>
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
                                                    Confirm & Accept
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
                                                onClick={() => updateOrderStatus(selectedOrder.id, 'rejected')}
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
                                        className="btn-accept"
                                        style={{ width: '100%' }}
                                        onClick={() => updateOrderStatus(selectedOrder.id, 'delivery_in_route')}
                                    >
                                        🚚 Mark as Picked Up / In Route
                                    </button>
                                </div>
                            )}

                            {selectedOrder.status === 'delivery_in_route' && isSuperAdmin && (
                                <div className="order-actions">
                                    <button
                                        className="btn-accept"
                                        style={{ width: '100%' }}
                                        onClick={() => updateOrderStatus(selectedOrder.id, 'fulfilled')}
                                    >
                                        ✅ Mark as Delivered (Fulfilled)
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
