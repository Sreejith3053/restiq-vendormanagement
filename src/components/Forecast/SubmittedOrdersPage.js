import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

const STATUS_CONFIG = {
    'Draft Suggestion': { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '📋', next: 'In Review' },
    'In Review': { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '🔍', next: 'Submitted' },
    'Submitted': { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', icon: '✅', next: 'Locked' },
    'Locked': { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', icon: '🔒', next: 'Aggregated' },
    'Aggregated': { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '🔄', next: 'Sent to Vendor' },
    'Sent to Vendor': { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '🚚', next: null },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

function StatusBadge({ status }) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Draft Suggestion'];
    return (
        <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 11px', borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {cfg.icon} {status}
        </span>
    );
}

function fmt(ts) {
    if (!ts) return '—';
    if (ts?.toDate) return ts.toDate().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
    const d = new Date(ts);
    return isNaN(d) ? '—' : d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function SubmittedOrdersPage() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeStatus, setActiveStatus] = useState('All');
    const [search, setSearch] = useState('');
    const [updating, setUpdating] = useState(null);
    const unsubRef = useRef(null);

    useEffect(() => {
        unsubRef.current = onSnapshot(collection(db, 'submittedOrders'), snap => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            docs.sort((a, b) => {
                const ta = a.submittedAt?.toDate?.() || new Date(a.submittedAt || 0);
                const tb = b.submittedAt?.toDate?.() || new Date(b.submittedAt || 0);
                return tb - ta;
            });
            setOrders(docs);
            setLoading(false);
        }, err => { console.error('SubmittedOrders error:', err); setLoading(false); });
        return () => unsubRef.current?.();
    }, []);

    const advanceStatus = async (order) => {
        const cfg = STATUS_CONFIG[order.status];
        if (!cfg?.next) return;
        setUpdating(order.id);
        try {
            await updateDoc(doc(db, 'submittedOrders', order.id), {
                status: cfg.next,
                updatedAt: serverTimestamp(),
                ...(cfg.next === 'Locked' ? { lockedAt: serverTimestamp() } : {}),
                ...(cfg.next === 'Aggregated' ? { aggregatedAt: serverTimestamp() } : {}),
            });
        } catch (err) { console.error(err); }
        setUpdating(null);
    };

    const filtered = orders.filter(o => {
        if (activeStatus !== 'All' && o.status !== activeStatus) return false;
        if (search) return o.restaurantName?.toLowerCase().includes(search.toLowerCase());
        return true;
    });

    // KPI counts
    const counts = {};
    ['All', ...ALL_STATUSES].forEach(s => {
        counts[s] = s === 'All' ? orders.length : orders.filter(o => o.status === s).length;
    });

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Submitted Orders
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    Restaurant final orders after review and submission — the source of truth before vendor dispatch.
                </p>
            </div>

            {/* Workflow reminder */}
            <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10, padding: '12px 20px', fontSize: 13, color: '#94a3b8', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {['Draft Suggestion', 'In Review', 'Submitted', 'Locked', 'Aggregated', 'Sent to Vendor'].map((s, i, arr) => {
                    const cfg = STATUS_CONFIG[s];
                    return (
                        <React.Fragment key={s}>
                            <span style={{ color: cfg.color, fontWeight: 700, fontSize: 12 }}>{cfg.icon} {s}</span>
                            {i < arr.length - 1 && <span style={{ color: '#334155' }}>→</span>}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 10, marginBottom: 22 }}>
                {['All', ...ALL_STATUSES].map(s => {
                    const cfg = STATUS_CONFIG[s] || {};
                    const active = activeStatus === s;
                    return (
                        <div key={s} onClick={() => setActiveStatus(s)}
                            style={{ background: active ? (cfg.bg || 'rgba(255,255,255,0.08)') : 'rgba(255,255,255,0.02)', border: `1px solid ${active ? (cfg.color || '#f8fafc') : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.2s' }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color: cfg.color || '#f8fafc' }}>{counts[s] || 0}</div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{s}</div>
                        </div>
                    );
                })}
            </div>

            {/* Search */}
            <div style={{ marginBottom: 20 }}>
                <input
                    placeholder="Search restaurant..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 260 }}
                />
            </div>

            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>⏳ Loading submitted orders...</div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>No orders found</div>
                        <div style={{ fontSize: 13 }}>
                            {activeStatus !== 'All'
                                ? `No orders with status "${activeStatus}".`
                                : 'No restaurant orders have been submitted yet. When a restaurant submits their final order from Suggested Orders, it will appear here.'}
                        </div>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {['Restaurant', 'Week', 'Delivery Day', 'Status', 'Submitted At', 'Total Items', 'Total Packs', 'Est. Billing', 'Action'].map(h => (
                                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(order => {
                                    const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG['Draft Suggestion'];
                                    const isUpdating = updating === order.id;
                                    const totalPacks = (order.items || []).reduce((s, i) => s + (i.totalQty || 0), 0);
                                    const totalBilling = (order.items || []).reduce((s, i) => s + (i.lineRestaurantBilling || 0), 0);
                                    return (
                                        <tr key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '13px 14px', fontWeight: 600, color: '#f8fafc' }}>{order.restaurantName || '—'}</td>
                                            <td style={{ padding: '13px 14px', color: '#94a3b8', fontSize: 12 }}>{order.weekLabel || '—'}</td>
                                            <td style={{ padding: '13px 14px' }}>
                                                {order.deliveryDay
                                                    ? <span style={{ background: order.deliveryDay === 'Monday' ? 'rgba(129,140,248,0.12)' : 'rgba(167,139,250,0.12)', color: order.deliveryDay === 'Monday' ? '#818cf8' : '#a78bfa', padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{order.deliveryDay}</span>
                                                    : <span style={{ color: '#475569' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '13px 14px' }}><StatusBadge status={order.status || 'Draft Suggestion'} /></td>
                                            <td style={{ padding: '13px 14px', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>{fmt(order.submittedAt)}</td>
                                            <td style={{ padding: '13px 14px', fontWeight: 600, color: '#f8fafc' }}>{(order.items || []).length}</td>
                                            <td style={{ padding: '13px 14px', fontWeight: 600, color: '#38bdf8' }}>{totalPacks}</td>
                                            <td style={{ padding: '13px 14px', color: '#ec4899', fontWeight: 600 }}>${totalBilling.toFixed(2)}</td>
                                            <td style={{ padding: '13px 14px' }}>
                                                {cfg.next ? (
                                                    <button
                                                        disabled={isUpdating}
                                                        onClick={() => advanceStatus(order)}
                                                        style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}44`, opacity: isUpdating ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                                                        {isUpdating ? '...' : `→ ${cfg.next}`}
                                                    </button>
                                                ) : (
                                                    <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 700 }}>✓ Complete</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Workflow note */}
            <div style={{ marginTop: 20, padding: '12px 18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, fontSize: 13, color: '#64748b' }}>
                💡 <strong style={{ color: '#94a3b8' }}>Important:</strong> Restaurant orders are NOT sent to vendors directly. After aggregation, use <strong style={{ color: '#38bdf8' }}>Vendor Dispatch</strong> in Control Tower to send a consolidated request to each vendor.
            </div>
        </div>
    );
}
