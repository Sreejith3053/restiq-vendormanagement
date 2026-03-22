import React, { useState, useEffect, useContext, useMemo } from 'react';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy, serverTimestamp } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import StatusChip from '../ui/StatusChip';
import GuidanceText, { pendingDuration } from '../ui/GuidanceText';

export default function DispatchRequestsPage() {
    const { vendorId, isSuperAdmin } = useContext(UserContext);
    const [dispatches, setDispatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All');
    const [savingIds, setSavingIds] = useState(new Set());
    const [bulkProcessing, setBulkProcessing] = useState(false);
    const navigate = useNavigate();

    // State to merge two sources
    const [dispatchItems, setDispatchItems] = useState([]);
    const [marketplaceItems, setMarketplaceItems] = useState([]);

    // Merge both sources into dispatches
    useEffect(() => {
        // Deduplicate: marketplace orders take priority if same ID exists
        const marketplaceIds = new Set(marketplaceItems.map(m => m.id));
        const merged = [
            ...marketplaceItems,
            ...dispatchItems.filter(d => !marketplaceIds.has(d.id)),
        ];
        merged.sort((a, b) => {
            const tA = a._sortTime || 0;
            const tB = b._sortTime || 0;
            return tB - tA;
        });
        setDispatches(merged);
    }, [dispatchItems, marketplaceItems]);

    // Source 1: vendorDispatches
    useEffect(() => {
        if (!isSuperAdmin && !vendorId) { setLoading(false); return; }

        let q;
        const dispatchesRef = collection(db, 'vendorDispatches');
        if (isSuperAdmin) {
            q = query(dispatchesRef);
        } else {
            q = query(dispatchesRef, where('vendorId', '==', vendorId));
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetched = snapshot.docs.map(d => {
                const data = d.data();
                const sentAt = data.sentAt?.toDate ? data.sentAt.toDate().getTime() : new Date(data.sentAt || 0).getTime();
                return { id: d.id, ...data, _source: 'dispatch', _sortTime: sentAt };
            });
            setDispatchItems(fetched);
            setLoading(false);
        }, (err) => {
            console.error('Error fetching dispatch requests:', err);
            if (err.message.includes('index')) { setLoading(false); return; }
            toast.error('Failed to load dispatch orders.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [vendorId, isSuperAdmin]);

    // Source 2: marketplaceOrders (vendor admin sees their orders here too)
    useEffect(() => {
        if (!vendorId && !isSuperAdmin) return;

        const ordersRef = collection(db, 'marketplaceOrders');
        let q;
        if (isSuperAdmin) {
            q = query(ordersRef, orderBy('createdAt', 'desc'));
        } else {
            q = query(ordersRef, where('vendorId', '==', vendorId), orderBy('createdAt', 'desc'));
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetched = snapshot.docs.map(d => {
                const data = d.data();
                const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : new Date(data.createdAt || 0).getTime();
                // Map marketplace order status to dispatch-style status
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

                return {
                    id: d.id,
                    dispatchId: data.orderGroupId || d.id.slice(-8).toUpperCase(),
                    vendorId: data.vendorId,
                    vendorName: data.vendorName,
                    restaurantName: data.restaurantName || data.restaurantId || '—',
                    status: dispatchStatus,
                    weekStart: data.createdAt,
                    weekEnd: null,
                    sentAt: data.createdAt,
                    vendorPayout: data.total || data.grandTotalAfterTax || 0,
                    items: data.items || [],
                    _source: 'marketplace',
                    _sortTime: createdAt,
                    _marketplaceStatus: s,
                    cancellationReason: data.cancellationReason || '',
                    cancelledBy: data.cancelledBy || '',
                    cancelledAt: data.cancelledAt || null,
                };
            });
            setMarketplaceItems(fetched);
        }, (err) => {
            console.error('Error fetching marketplace orders:', err);
        });

        return () => unsubscribe();
    }, [vendorId, isSuperAdmin]);

    // ── KPI Stats ───────────────────────────────────────────────────
    const kpis = useMemo(() => {
        let pending = 0, confirmed = 0, inTransit = 0, delivered = 0, rejected = 0;
        dispatches.forEach(d => {
            const s = d.status || '';
            if (s === 'Sent' || s === 'Vendor Reviewing' || s === 'Pending Customer Approval') pending++;
            else if (s === 'Confirmed' || s === 'Partially Confirmed') confirmed++;
            else if (s === 'Packed' || s === 'Out for Delivery') inTransit++;
            else if (s === 'Delivered') delivered++;
            else if (s === 'Rejected' || s === 'Cancelled by Customer') rejected++;
        });
        return { pending, confirmed, inTransit, delivered, rejected, total: dispatches.length };
    }, [dispatches]);

    // ── Guidance text ────────────────────────────────────────────────
    const guidance = useMemo(() => {
        if (kpis.pending > 0) {
            return { text: `${kpis.pending} order${kpis.pending > 1 ? 's' : ''} pending — confirm within 4 hours to maintain response score`, type: 'warning' };
        }
        if (kpis.inTransit > 0) {
            return { text: `${kpis.inTransit} order${kpis.inTransit > 1 ? 's' : ''} in transit — update delivery status when completed`, type: 'info' };
        }
        if (kpis.total === 0) return null;
        return { text: 'All orders up to date', type: 'success' };
    }, [kpis]);

    const formatDate = (timestamp) => {
        if (!timestamp) return '';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
    };

    const filteredDispatches = dispatches.filter(d => {
        if (statusFilter === 'All') return true;
        if (statusFilter === 'Active') return !['Delivered', 'Rejected', 'Cancelled by Customer'].includes(d.status);
        if (statusFilter === 'Pending') return ['Sent', 'Vendor Reviewing', 'Pending Customer Approval'].includes(d.status);
        if (statusFilter === 'Rejected') return d.status === 'Rejected' || d.status === 'Cancelled by Customer';
        return d.status === statusFilter;
    });

    const pendingDispatches = dispatches.filter(d => d.status === 'Sent' || d.status === 'Vendor Reviewing');

    // ── Inline Quick Actions ─────────────────────────────────────────
    const handleQuickConfirm = async (dispatch, e) => {
        e.stopPropagation();
        setSavingIds(prev => new Set([...prev, dispatch.id]));
        try {
            const docRef = doc(db, 'vendorDispatches', dispatch.id);
            await updateDoc(docRef, {
                status: 'Confirmed',
                confirmedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            toast.success(`Order ${dispatch.dispatchId || dispatch.id.slice(-6)} confirmed`);
        } catch (err) {
            console.error('Quick confirm error:', err);
            toast.error('Failed to confirm');
        } finally {
            setSavingIds(prev => { const n = new Set(prev); n.delete(dispatch.id); return n; });
        }
    };

    const handleQuickReject = async (dispatch, e) => {
        e.stopPropagation();
        setSavingIds(prev => new Set([...prev, dispatch.id]));
        try {
            const docRef = doc(db, 'vendorDispatches', dispatch.id);
            await updateDoc(docRef, {
                status: 'Rejected',
                rejectedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            toast.info(`Order ${dispatch.dispatchId || dispatch.id.slice(-6)} rejected`);
        } catch (err) {
            console.error('Quick reject error:', err);
            toast.error('Failed to reject');
        } finally {
            setSavingIds(prev => { const n = new Set(prev); n.delete(dispatch.id); return n; });
        }
    };

    // ── Bulk Actions ─────────────────────────────────────────────────
    const handleBulkConfirmAll = async () => {
        if (pendingDispatches.length === 0) return;
        if (!window.confirm(`Confirm all ${pendingDispatches.length} pending orders?`)) return;
        setBulkProcessing(true);
        let ok = 0, fail = 0;
        for (const d of pendingDispatches) {
            try {
                await updateDoc(doc(db, 'vendorDispatches', d.id), {
                    status: 'Confirmed',
                    confirmedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                ok++;
            } catch { fail++; }
        }
        toast.success(`Confirmed ${ok} orders${fail > 0 ? ` (${fail} failed)` : ''}`);
        setBulkProcessing(false);
    };

    const handleBulkRejectAll = async () => {
        if (pendingDispatches.length === 0) return;
        if (!window.confirm(`Reject all ${pendingDispatches.length} pending orders? This cannot be undone.`)) return;
        setBulkProcessing(true);
        let ok = 0, fail = 0;
        for (const d of pendingDispatches) {
            try {
                await updateDoc(doc(db, 'vendorDispatches', d.id), {
                    status: 'Rejected',
                    rejectedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                ok++;
            } catch { fail++; }
        }
        toast.info(`Rejected ${ok} orders${fail > 0 ? ` (${fail} failed)` : ''}`);
        setBulkProcessing(false);
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading orders...</div>;
    }

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: '#f8fafc' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px 0' }}>📦 Orders</h1>
                    <p style={{ color: '#94a3b8', margin: 0, fontSize: 14 }}>Manage weekly supply orders — confirm, pack, and track deliveries.</p>
                </div>
            </div>

            {/* Guidance */}
            {guidance && <GuidanceText text={guidance.text} type={guidance.type} style={{ marginBottom: 16 }} />}

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                    { label: 'Pending', value: kpis.pending, color: '#f59e0b', icon: '📩', filter: 'Sent' },
                    { label: 'Confirmed', value: kpis.confirmed, color: '#38bdf8', icon: '✅', filter: 'Confirmed' },
                    { label: 'In Transit', value: kpis.inTransit, color: '#6366f1', icon: '🚚', filter: 'Active' },
                    { label: 'Delivered', value: kpis.delivered, color: '#10b981', icon: '✓', filter: 'Delivered' },
                    { label: 'Rejected', value: kpis.rejected, color: '#f43f5e', icon: '❌', filter: 'Rejected' },
                ].map(k => (
                    <div
                        key={k.label}
                        onClick={() => setStatusFilter(k.filter)}
                        style={{
                            background: statusFilter === k.filter ? `${k.color}15` : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${statusFilter === k.filter ? `${k.color}44` : 'rgba(255,255,255,0.06)'}`,
                            borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
                            transition: 'all 0.2s', textAlign: 'center',
                        }}
                    >
                        <div style={{ fontSize: 11, color: k.color, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{k.icon} {k.label}</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: k.value > 0 ? k.color : '#475569' }}>{k.value}</div>
                    </div>
                ))}
            </div>

            {/* Bulk Actions + Filter Bar */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                    className="ui-input"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{ maxWidth: 200, background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 8 }}
                >
                    <option value="All">All Statuses</option>
                    <option value="Active">Active Only</option>
                    <option value="Sent">Pending</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Packed">Packed</option>
                    <option value="Out for Delivery">Out for Delivery</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Rejected">Rejected</option>
                </select>
                <span style={{ fontSize: 13, color: '#64748b' }}>{filteredDispatches.length} of {dispatches.length} orders</span>

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Bulk actions — only show when there are pending orders */}
                {pendingDispatches.length > 0 && !isSuperAdmin && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#64748b', marginRight: 4 }}>Bulk:</span>
                        <button
                            className="ui-btn"
                            onClick={handleBulkConfirmAll}
                            disabled={bulkProcessing}
                            style={{ padding: '5px 12px', fontSize: 11, background: '#10b981', color: '#fff', border: 'none', fontWeight: 700, borderRadius: 6 }}
                        >
                            ✅ Confirm All ({pendingDispatches.length})
                        </button>
                        <button
                            className="ui-btn"
                            onClick={handleBulkRejectAll}
                            disabled={bulkProcessing}
                            style={{ padding: '5px 12px', fontSize: 11, background: 'rgba(244,63,94,0.15)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.3)', fontWeight: 700, borderRadius: 6 }}
                        >
                            ❌ Reject All
                        </button>
                    </div>
                )}
            </div>

            {/* Visual Status Flow */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20, padding: '8px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto' }}>
                {[
                    { label: 'Sent', count: dispatches.filter(d => d.status === 'Sent' || d.status === 'Vendor Reviewing').length, color: '#f59e0b' },
                    { label: 'Confirmed', count: dispatches.filter(d => d.status === 'Confirmed' || d.status === 'Partially Confirmed').length, color: '#38bdf8' },
                    { label: 'Packed', count: dispatches.filter(d => d.status === 'Packed').length, color: '#6366f1' },
                    { label: 'Delivering', count: dispatches.filter(d => d.status === 'Out for Delivery').length, color: '#0ea5e9' },
                    { label: 'Delivered', count: dispatches.filter(d => d.status === 'Delivered').length, color: '#10b981' },
                ].map((step, i, arr) => (
                    <React.Fragment key={step.label}>
                        <div style={{ textAlign: 'center', minWidth: 80, flex: 1 }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: step.count > 0 ? step.color : '#475569' }}>{step.count}</div>
                            <div style={{ fontSize: 10, color: step.count > 0 ? step.color : '#475569', fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>{step.label}</div>
                        </div>
                        {i < arr.length - 1 && <div style={{ color: '#334155', fontSize: 14, margin: '0 4px' }}>→</div>}
                    </React.Fragment>
                ))}
            </div>

            {/* Orders Table */}
            <div className="ui-table-wrap" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <table className="ui-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                            <th style={thStyle}>Order ID</th>
                            <th style={thStyle}>Week</th>
                            <th style={thStyle}>Restaurant</th>
                            <th style={thStyle}>Status</th>
                            <th style={thStyle}>Pending</th>
                            <th style={thStyle}>Payout</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredDispatches.length === 0 ? (
                            <tr>
                                <td colSpan={7} style={{ padding: 48, textAlign: 'center' }}>
                                    <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                                    <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                                        {statusFilter === 'All' ? 'No orders this week' : `No ${statusFilter.toLowerCase()} orders`}
                                    </div>
                                    <div style={{ color: '#64748b', fontSize: 13, maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
                                        {statusFilter === 'All'
                                            ? 'Orders appear when restaurants submit weekly orders. Check your Demand page or update Capacity to receive allocation.'
                                            : 'Try changing the status filter to see other orders.'}
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredDispatches.map(dispatch => {
                                const isPending = dispatch.status === 'Sent' || dispatch.status === 'Vendor Reviewing';
                                const isSaving = savingIds.has(dispatch.id);
                                const dur = isPending ? pendingDuration(dispatch.sentAt) : null;

                                return (
                                    <tr
                                        key={dispatch.id}
                                        style={{
                                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                                            cursor: 'pointer',
                                            transition: 'background 0.2s',
                                            background: isPending ? 'rgba(245,158,11,0.03)' : 'transparent',
                                        }}
                                        onClick={() => navigate(`/dispatch-requests/${dispatch.id}`)}
                                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                                        onMouseOut={(e) => e.currentTarget.style.background = isPending ? 'rgba(245,158,11,0.03)' : 'transparent'}
                                    >
                                        <td style={{ padding: '14px 16px', fontWeight: 600, fontFamily: 'monospace', fontSize: 13 }}>
                                            {dispatch.dispatchId || dispatch.id.slice(-8).toUpperCase()}
                                        </td>
                                        <td style={{ padding: '14px 16px', color: '#e2e8f0', fontSize: 13 }}>
                                            {formatDate(dispatch.weekStart)} – {formatDate(dispatch.weekEnd)}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontWeight: 500, fontSize: 13 }}>{dispatch.restaurantName}</td>
                                        <td style={{ padding: '14px 16px' }}>
                                            <StatusChip status={dispatch.status} size="sm" />
                                        </td>
                                        <td style={{ padding: '14px 16px' }}>
                                            {dur ? (
                                                <span style={{
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    padding: '2px 8px',
                                                    borderRadius: 12,
                                                    background: dur.level === 'danger' ? 'rgba(244,63,94,0.12)' : dur.level === 'warning' ? 'rgba(245,158,11,0.12)' : 'rgba(56,189,248,0.08)',
                                                    color: dur.level === 'danger' ? '#f43f5e' : dur.level === 'warning' ? '#f59e0b' : '#38bdf8',
                                                }}>
                                                    ⏱ {dur.text}
                                                </span>
                                            ) : (
                                                <span style={{ color: '#475569', fontSize: 12 }}>—</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '14px 16px', fontWeight: 600, color: '#fbbf24', fontSize: 13 }}>
                                            {formatCurrency(dispatch.vendorPayout)}
                                        </td>
                                        <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                            {isPending && !isSuperAdmin ? (
                                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                    <button
                                                        onClick={(e) => handleQuickConfirm(dispatch, e)}
                                                        disabled={isSaving}
                                                        style={{ padding: '4px 10px', fontSize: 11, background: '#10b981', color: '#fff', border: 'none', fontWeight: 700, borderRadius: 6, cursor: 'pointer', opacity: isSaving ? 0.5 : 1 }}
                                                    >
                                                        {isSaving ? '...' : '✅ Confirm'}
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleQuickReject(dispatch, e)}
                                                        disabled={isSaving}
                                                        style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(244,63,94,0.12)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)', fontWeight: 700, borderRadius: 6, cursor: 'pointer', opacity: isSaving ? 0.5 : 1 }}
                                                    >
                                                        ❌
                                                    </button>
                                                    <button
                                                        className="ui-btn ghost"
                                                        style={{ padding: '4px 10px', fontSize: 11 }}
                                                        onClick={() => navigate(`/dispatch-requests/${dispatch.id}`)}
                                                    >
                                                        Details
                                                    </button>
                                                </div>
                                            ) : (
                                                <button className="ui-btn ghost" style={{ padding: '6px 12px', fontSize: 12 }}
                                                    onClick={() => navigate(`/dispatch-requests/${dispatch.id}`)}>
                                                    View →
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const thStyle = { padding: '12px 16px', color: '#94a3b8', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', whiteSpace: 'nowrap' };
