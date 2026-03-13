import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

const STATUS_CONFIG = {
    'pending_confirmation': { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '⏳', label: 'Pending Confirmation' },
    'pending_customer_approval': { color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: '👁️', label: 'Pending Approval' },
    'pending_fulfillment': { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', icon: '📋', label: 'Pending Fulfillment' },
    'delivery_in_route': { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', icon: '🚚', label: 'Delivery In Route' },
    'delivered_awaiting_confirmation': { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '📦', label: 'Delivered - Awaiting' },
    'in_review': { color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: '🔍', label: 'In Review' },
    'fulfilled': { color: '#4ade80', bg: 'rgba(74,222,128,0.12)', icon: '✅', label: 'Fulfilled' },
    'completed': { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '✅', label: 'Completed' },
    'cancelled_by_vendor': { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', icon: '❌', label: 'Cancelled' },
    'cancelled_by_customer': { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '❌', label: 'Cancelled' },
    'rejected': { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '🚫', label: 'Rejected' },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

function StatusBadge({ status }) {
    const cfg = STATUS_CONFIG[status] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '❓', label: status?.replace(/_/g, ' ') || 'Unknown' };
    return (
        <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 11px', borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {cfg.icon} {cfg.label}
        </span>
    );
}

function fmt(ts) {
    if (!ts) return '—';
    if (ts?.toDate) return ts.toDate().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
    const d = new Date(ts);
    return isNaN(d) ? '—' : d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount || 0);
}

export default function SubmittedOrdersPage() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeStatus, setActiveStatus] = useState('All');
    const [search, setSearch] = useState('');
    const unsubRef = useRef(null);

    useEffect(() => {
        unsubRef.current = onSnapshot(collection(db, 'marketplaceOrders'), snap => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            docs.sort((a, b) => {
                const ta = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
                const tb = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
                return tb - ta;
            });
            setOrders(docs);
            setLoading(false);
        }, err => { console.error('MarketplaceOrders error:', err); setLoading(false); });
        return () => unsubRef.current?.();
    }, []);

    const filtered = orders.filter(o => {
        if (activeStatus !== 'All' && o.status !== activeStatus) return false;
        if (search) {
            const s = search.toLowerCase();
            return (o.restaurantId || '').toLowerCase().includes(s) ||
                   (o.vendorName || '').toLowerCase().includes(s) ||
                   (o.orderGroupId || '').toLowerCase().includes(s);
        }
        return true;
    });

    // KPI counts
    const counts = {};
    counts['All'] = orders.length;
    ALL_STATUSES.forEach(s => {
        counts[s] = orders.filter(o => o.status === s).length;
    });

    // Only show statuses that have orders
    const visibleStatuses = ALL_STATUSES.filter(s => counts[s] > 0);

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Marketplace Orders
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    All marketplace orders across restaurants and vendors — track status from submission to fulfillment.
                </p>
            </div>

            {/* Status Flow */}
            <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10, padding: '12px 20px', fontSize: 13, color: '#94a3b8', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {['pending_confirmation', 'pending_fulfillment', 'delivery_in_route', 'delivered_awaiting_confirmation', 'fulfilled'].map((s, i, arr) => {
                    const cfg = STATUS_CONFIG[s];
                    return (
                        <React.Fragment key={s}>
                            <span style={{ color: cfg.color, fontWeight: 700, fontSize: 12 }}>{cfg.icon} {cfg.label}</span>
                            {i < arr.length - 1 && <span style={{ color: '#334155' }}>→</span>}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* KPI Strip */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
                <div onClick={() => setActiveStatus('All')}
                    style={{ background: activeStatus === 'All' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${activeStatus === 'All' ? '#f8fafc' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.2s', minWidth: 80 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>{counts['All']}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>All</div>
                </div>
                {visibleStatuses.map(s => {
                    const cfg = STATUS_CONFIG[s];
                    const active = activeStatus === s;
                    return (
                        <div key={s} onClick={() => setActiveStatus(s)}
                            style={{ background: active ? cfg.bg : 'rgba(255,255,255,0.02)', border: `1px solid ${active ? cfg.color : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.2s', minWidth: 80 }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color: cfg.color }}>{counts[s]}</div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{cfg.label}</div>
                        </div>
                    );
                })}
            </div>

            {/* Search */}
            <div style={{ marginBottom: 20 }}>
                <input
                    placeholder="Search restaurant, vendor, or order ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 320 }}
                />
            </div>

            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>⏳ Loading marketplace orders...</div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>No orders found</div>
                        <div style={{ fontSize: 13 }}>
                            {activeStatus !== 'All'
                                ? `No orders with status "${STATUS_CONFIG[activeStatus]?.label || activeStatus}".`
                                : 'No marketplace orders yet.'}
                        </div>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {['Order ID', 'Restaurant', 'Vendor', 'Status', 'Date', 'Delivery Day', 'Items', 'Total'].map(h => (
                                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(order => {
                                    const itemCount = (order.items || []).length;
                                    const total = order.grandTotalAfterTax || order.total || 0;
                                    return (
                                        <tr key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '13px 14px', fontFamily: 'monospace', fontWeight: 600, color: '#38bdf8', fontSize: 12 }}>{order.orderGroupId || order.id.slice(-8).toUpperCase()}</td>
                                            <td style={{ padding: '13px 14px', fontWeight: 600, color: '#f8fafc' }}>{order.restaurantId || '—'}</td>
                                            <td style={{ padding: '13px 14px', color: '#94a3b8' }}>{order.vendorName || '—'}</td>
                                            <td style={{ padding: '13px 14px' }}><StatusBadge status={order.status} /></td>
                                            <td style={{ padding: '13px 14px', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(order.createdAt)}</td>
                                            <td style={{ padding: '13px 14px' }}>
                                                {order.deliveryDay
                                                    ? <span style={{ background: order.deliveryDay === 'Monday' ? 'rgba(129,140,248,0.12)' : 'rgba(167,139,250,0.12)', color: order.deliveryDay === 'Monday' ? '#818cf8' : '#a78bfa', padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{order.deliveryDay}</span>
                                                    : <span style={{ color: '#475569' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '13px 14px', fontWeight: 600, color: '#f8fafc' }}>{itemCount}</td>
                                            <td style={{ padding: '13px 14px', color: '#ec4899', fontWeight: 700 }}>{formatCurrency(total)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
