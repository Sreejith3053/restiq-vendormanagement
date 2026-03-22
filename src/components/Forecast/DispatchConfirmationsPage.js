import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { RouteDayBadge, RaiseIssueModal } from './DispatchShared';

// Unified statuses across both dispatch routes and marketplace orders
const STATUSES = ['All', 'Pending', 'Confirmed', 'In Transit', 'Delivered', 'Fulfilled', 'Rejected', 'Cancelled'];

const STATUS_CONFIG = {
    // Dispatch route statuses
    Sent: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '📤' },
    Confirmed: { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '✅' },
    'Partially Confirmed': { color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: '⚠️' },
    Rejected: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: '❌' },
    Delivered: { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '🎉' },
    Closed: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '🔒' },
    Draft: { color: '#64748b', bg: 'rgba(100,116,139,0.1)', icon: '📋' },
    // Marketplace order statuses (mapped to display labels)
    Pending: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '⏳' },
    'In Transit': { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', icon: '🚚' },
    Fulfilled: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)', icon: '✅' },
    'Awaiting Confirmation': { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '📦' },
    Completed: { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '✅' },
    Cancelled: { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', icon: '❌' },
};

// Map marketplace order statuses to unified display labels
function mapMarketplaceStatus(status) {
    const map = {
        pending_confirmation: 'Pending',
        pending_customer_approval: 'Pending',
        pending_fulfillment: 'Confirmed',
        delivery_in_route: 'In Transit',
        delivered_awaiting_confirmation: 'Delivered',
        fulfilled: 'Fulfilled',
        completed: 'Fulfilled',
        cancelled_by_vendor: 'Rejected',
        cancelled_by_customer: 'Cancelled',
        rejected: 'Rejected',
    };
    return map[status] || status;
}

function fmt(ts) {
    if (!ts) return '—';
    if (ts?.toDate) return ts.toDate().toLocaleDateString('en-CA');
    const d = new Date(ts);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-CA');
}

function StatusBadge({ status }) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.Draft;
    return (
        <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {cfg.icon} {status}
        </span>
    );
}

function SourceBadge({ source }) {
    const isMarketplace = source === 'marketplace';
    return (
        <span style={{
            background: isMarketplace ? 'rgba(56,189,248,0.1)' : 'rgba(167,139,250,0.1)',
            color: isMarketplace ? '#38bdf8' : '#a78bfa',
            padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700
        }}>
            {isMarketplace ? '🏪 Marketplace' : '📦 Dispatch'}
        </span>
    );
}

export default function DispatchConfirmationsPage() {
    const [dispatches, setDispatches] = useState([]);
    const [marketplaceOrders, setMarketplaceOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeStatus, setActiveStatus] = useState('All');
    const [activeDay, setActiveDay] = useState('All');
    const [activeSource, setActiveSource] = useState('All');
    const [search, setSearch] = useState('');
    const [raiseIssue, setRaiseIssue] = useState(null);
    const unsubDispatchRef = useRef(null);
    const unsubMarketRef = useRef(null);

    useEffect(() => {
        setLoading(true);
        let dispatchLoaded = false, marketLoaded = false;
        const checkDone = () => { if (dispatchLoaded && marketLoaded) setLoading(false); };

        // Listen to vendor dispatch routes
        unsubDispatchRef.current = onSnapshot(
            collection(db, 'vendorDispatchRoutes'),
            (snap) => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data(), _source: 'dispatch' }));
                setDispatches(docs);
                dispatchLoaded = true;
                checkDone();
            },
            (err) => { console.error('Dispatch error:', err); dispatchLoaded = true; checkDone(); }
        );

        // Listen to marketplace orders
        unsubMarketRef.current = onSnapshot(
            collection(db, 'marketplaceOrders'),
            (snap) => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data(), _source: 'marketplace' }));
                setMarketplaceOrders(docs);
                marketLoaded = true;
                checkDone();
            },
            (err) => { console.error('Marketplace error:', err); marketLoaded = true; checkDone(); }
        );

        return () => {
            unsubDispatchRef.current?.();
            unsubMarketRef.current?.();
        };
    }, []);

    // Normalize both sources into a unified list
    const allRecords = [
        ...dispatches.map(d => ({
            id: d.id,
            source: 'dispatch',
            vendorName: d.vendorName || '—',
            restaurant: d.restaurantName || '—',
            orderId: d.routeDispatchId || d.dispatchId || d.id,
            routeDay: d.routeDay || '—',
            week: d.weekLabel || '—',
            displayStatus: d.status || 'Draft',
            sentAt: d.sentAt,
            confirmedAt: d.confirmedAt,
            deliveredAt: d.deliveredAt,
            notes: d.confirmationNotes || d.rejectionReason || '',
            raw: d,
        })),
        ...marketplaceOrders.map(o => ({
            id: o.id,
            source: 'marketplace',
            vendorName: o.vendorName || '—',
            restaurant: o.restaurantId || '—',
            orderId: o.orderGroupId || o.id.slice(-8).toUpperCase(),
            routeDay: o.deliveryDay || '—',
            week: '—',
            displayStatus: mapMarketplaceStatus(o.status),
            sentAt: o.createdAt,
            confirmedAt: o.confirmedAt || null,
            deliveredAt: o.deliveredAt || null,
            notes: o.cancellationReason || '',
            raw: o,
        })),
    ];

    // Sort by date descending
    allRecords.sort((a, b) => {
        const ta = a.sentAt?.toDate?.() || (a.sentAt ? new Date(a.sentAt) : new Date(0));
        const tb = b.sentAt?.toDate?.() || (b.sentAt ? new Date(b.sentAt) : new Date(0));
        return tb - ta;
    });

    const filtered = allRecords.filter(d => {
        if (activeSource !== 'All' && d.source !== activeSource) return false;
        if (activeStatus !== 'All' && d.displayStatus !== activeStatus) return false;
        if (activeDay !== 'All' && d.routeDay !== activeDay) return false;
        if (search) {
            const q = search.toLowerCase();
            return d.vendorName?.toLowerCase().includes(q)
                || d.orderId?.toLowerCase().includes(q)
                || d.restaurant?.toLowerCase().includes(q)
                || d.week?.toLowerCase().includes(q);
        }
        return true;
    });

    // KPI counts
    const counts = {};
    STATUSES.slice(1).forEach(s => { counts[s] = allRecords.filter(d => d.displayStatus === s).length; });

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Dispatch &amp; Delivery Confirmations
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    Track vendor dispatch responses and marketplace order deliveries — all confirmation statuses in one place.
                </p>
            </div>

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, marginBottom: 24 }}>
                {STATUSES.slice(1).map(s => {
                    const cfg = STATUS_CONFIG[s] || STATUS_CONFIG.Draft;
                    return (
                        <div key={s} onClick={() => setActiveStatus(s === activeStatus ? 'All' : s)}
                            style={{ background: activeStatus === s ? cfg.bg : 'rgba(255,255,255,0.03)', border: `1px solid ${cfg.color}33`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}>
                            <div style={{ fontSize: 18 }}>{cfg.icon}</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: cfg.color, margin: '4px 0 2px' }}>{counts[s] || 0}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{s}</div>
                        </div>
                    );
                })}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
                <input
                    placeholder="Search vendor, restaurant, or order ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 280 }}
                />
                {/* Source filter */}
                <div style={{ display: 'flex', gap: 6 }}>
                    {['All', 'marketplace', 'dispatch'].map(s => (
                        <button key={s} onClick={() => setActiveSource(s)} style={{
                            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            background: activeSource === s ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                            color: activeSource === s ? '#f8fafc' : '#94a3b8',
                            border: `1px solid ${activeSource === s ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                        }}>
                            {s === 'All' ? 'All Sources' : s === 'marketplace' ? '🏪 Marketplace' : '📦 Dispatch'}
                        </button>
                    ))}
                </div>
                {/* Route Day filter */}
                <div style={{ display: 'flex', gap: 6 }}>
                    {['All', 'Monday', 'Thursday'].map(d => (
                        <button key={d} onClick={() => setActiveDay(d)} style={{
                            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            background: activeDay === d ? (d === 'Monday' ? 'rgba(129,140,248,0.15)' : d === 'Thursday' ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.1)') : 'rgba(255,255,255,0.04)',
                            color: activeDay === d ? (d === 'Monday' ? '#818cf8' : d === 'Thursday' ? '#a78bfa' : '#f8fafc') : '#94a3b8',
                            border: `1px solid ${activeDay === d ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                        }}>
                            {d === 'All' ? 'All Days' : `📅 ${d}`}
                        </button>
                    ))}
                </div>
                {/* Status pill filters */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {STATUSES.map(s => {
                        const cfg = STATUS_CONFIG[s] || {};
                        const active = activeStatus === s;
                        return (
                            <button key={s} onClick={() => setActiveStatus(s)} style={{
                                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                background: active ? (cfg.bg || 'rgba(255,255,255,0.12)') : 'rgba(255,255,255,0.04)',
                                color: active ? (cfg.color || '#f8fafc') : '#94a3b8',
                                border: `1px solid ${active ? (cfg.color || '#f8fafc') : 'rgba(255,255,255,0.08)'}`,
                            }}>{s}</button>
                        );
                    })}
                </div>
            </div>

            {/* Table */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>⏳ Loading records...</div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>No records found</div>
                        <div style={{ fontSize: 13 }}>
                            {activeStatus !== 'All' ? `No records with status "${activeStatus}".` : 'No dispatch or marketplace delivery records yet.'}
                        </div>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {['Source', 'Route Day', 'Vendor', 'Restaurant', 'Order / Dispatch ID', 'Status', 'Created', 'Confirmed', 'Delivered', 'Notes', ''].map(h => (
                                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((d) => (
                                    <tr key={`${d.source}_${d.id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                        <td style={{ padding: '12px 14px' }}><SourceBadge source={d.source} /></td>
                                        <td style={{ padding: '12px 14px' }}>
                                            {d.routeDay && d.routeDay !== '—'
                                                ? <RouteDayBadge routeDay={d.routeDay} size="small" />
                                                : <span style={{ color: '#475569' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '12px 14px', fontWeight: 600, color: '#f8fafc' }}>{d.vendorName}</td>
                                        <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12 }}>{d.restaurant}</td>
                                        <td style={{ padding: '12px 14px', color: '#64748b', fontSize: 11, fontFamily: 'monospace', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.orderId}>{d.orderId?.slice(0, 24) || '—'}</td>
                                        <td style={{ padding: '12px 14px' }}><StatusBadge status={d.displayStatus} /></td>
                                        <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.sentAt)}</td>
                                        <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.confirmedAt)}</td>
                                        <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.deliveredAt)}</td>
                                        <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.notes}>{d.notes || '—'}</td>
                                        <td style={{ padding: '12px 14px' }}>
                                            <button onClick={() => setRaiseIssue({
                                                dispatchId: d.orderId,
                                                vendorId: d.raw.vendorId || '',
                                                vendorName: d.vendorName || '',
                                                restaurantId: d.raw.restaurantId || '',
                                                restaurantName: d.restaurant || '',
                                                routeDay: d.routeDay || 'Monday',
                                            })}
                                                style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(244,63,94,0.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)', whiteSpace: 'nowrap' }}>
                                                🚨 Issue
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Info notes */}
            <div style={{ marginTop: 16, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 10, padding: '11px 16px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>ℹ️</span>
                <span><strong style={{ color: '#fbbf24' }}>Note:</strong> This page shows <strong>both</strong> vendor dispatch routes and marketplace order deliveries. Use the source filter to view them separately.</span>
            </div>

            {raiseIssue && <RaiseIssueModal defaults={raiseIssue} onClose={() => setRaiseIssue(null)} />}
        </div>
    );
}
