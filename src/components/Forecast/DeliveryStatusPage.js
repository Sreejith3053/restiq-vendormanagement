import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { RouteDayBadge, RaiseIssueModal } from './DispatchShared';

const STATUS_CONFIG = {
    'Awaiting Confirmation': { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '⏳' },
    'Confirmed': { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '✅' },
    'Picking': { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', icon: '🔵' },
    'Loaded': { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', icon: '🚛' },
    'In Transit': { color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: '🚚' },
    'Delivered': { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '🎉' },
    'Fulfilled': { color: '#4ade80', bg: 'rgba(74,222,128,0.12)', icon: '✅' },
    'Cancelled': { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', icon: '❌' },
    'Closed': { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '🔒' },
};

// Map dispatch statuses to delivery statuses
const DISPATCH_TO_DELIVERY = {
    'Sent': 'Awaiting Confirmation',
    'Confirmed': 'Confirmed',
    'Partially Confirmed': 'Confirmed',
    'Picking': 'Picking',
    'Loaded': 'Loaded',
    'Out for Delivery': 'In Transit',
    'Delivered': 'Delivered',
    'Closed': 'Closed',
};

// Map marketplace order statuses to delivery statuses
const MARKETPLACE_TO_DELIVERY = {
    'pending_confirmation': 'Awaiting Confirmation',
    'pending_customer_approval': 'Awaiting Confirmation',
    'pending_fulfillment': 'Confirmed',
    'delivery_in_route': 'In Transit',
    'delivered_awaiting_confirmation': 'Delivered',
    'fulfilled': 'Fulfilled',
    'completed': 'Fulfilled',
    'cancelled_by_vendor': 'Cancelled',
    'cancelled_by_customer': 'Cancelled',
    'rejected': 'Cancelled',
};

function StatusBadge({ status }) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Awaiting Confirmation'];
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

function fmt(ts) {
    if (!ts) return '—';
    if (ts?.toDate) return ts.toDate().toLocaleDateString('en-CA');
    const d = new Date(ts);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-CA');
}

function fmtWeek(ts) {
    if (!ts) return 'Unknown Week';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return 'Unknown Week';
    // Get Monday of the week
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    return `${monday.toLocaleDateString('en-CA', opts)} – ${sunday.toLocaleDateString('en-CA', opts)}`;
}

export default function DeliveryStatusPage() {
    const [dispatches, setDispatches] = useState([]);
    const [marketplaceOrders, setMarketplaceOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('All');
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

        unsubDispatchRef.current = onSnapshot(collection(db, 'vendorDispatchRoutes'), snap => {
            setDispatches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            dispatchLoaded = true;
            checkDone();
        }, () => { dispatchLoaded = true; checkDone(); });

        unsubMarketRef.current = onSnapshot(collection(db, 'marketplaceOrders'), snap => {
            setMarketplaceOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            marketLoaded = true;
            checkDone();
        }, () => { marketLoaded = true; checkDone(); });

        return () => {
            unsubDispatchRef.current?.();
            unsubMarketRef.current?.();
        };
    }, []);

    // Normalize both sources into unified records
    const allRecords = [
        ...dispatches.map(d => ({
            id: d.id,
            source: 'dispatch',
            vendorName: d.vendorName || '—',
            restaurant: d.restaurantName || '—',
            orderId: d.routeDispatchId || d.dispatchId || d.id,
            routeDay: d.routeDay || '—',
            weekLabel: d.weekLabel || fmtWeek(d.sentAt),
            deliveryStatus: DISPATCH_TO_DELIVERY[d.status] || 'Awaiting Confirmation',
            rawStatus: d.status || 'Draft',
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
            weekLabel: fmtWeek(o.createdAt),
            deliveryStatus: MARKETPLACE_TO_DELIVERY[o.status] || 'Awaiting Confirmation',
            rawStatus: o.status?.replace(/_/g, ' ') || '—',
            sentAt: o.createdAt,
            confirmedAt: o.confirmedAt || null,
            deliveredAt: o.deliveredAt || null,
            notes: '',
            raw: o,
        })),
    ];

    // Sort by date descending
    allRecords.sort((a, b) => {
        const ta = a.sentAt?.toDate?.() || (a.sentAt ? new Date(a.sentAt) : new Date(0));
        const tb = b.sentAt?.toDate?.() || (b.sentAt ? new Date(b.sentAt) : new Date(0));
        return tb - ta;
    });

    const allStatuses = ['All', ...Object.keys(STATUS_CONFIG)];

    const filtered = allRecords.filter(d => {
        if (activeSource !== 'All' && d.source !== activeSource) return false;
        if (activeFilter !== 'All' && d.deliveryStatus !== activeFilter) return false;
        if (activeDay !== 'All' && d.routeDay !== activeDay) return false;
        if (search) {
            const q = search.toLowerCase();
            return d.vendorName?.toLowerCase().includes(q)
                || d.orderId?.toLowerCase().includes(q)
                || d.restaurant?.toLowerCase().includes(q)
                || d.weekLabel?.toLowerCase().includes(q);
        }
        return true;
    });

    // KPI counts
    const activeCount = allRecords.filter(d => !['Delivered', 'Fulfilled', 'Closed', 'Cancelled'].includes(d.deliveryStatus)).length;
    const deliveredCount = allRecords.filter(d => ['Delivered', 'Fulfilled'].includes(d.deliveryStatus)).length;
    const awaitingCount = allRecords.filter(d => d.deliveryStatus === 'Awaiting Confirmation').length;
    const inTransitCount = allRecords.filter(d => d.deliveryStatus === 'In Transit').length;

    // Group filtered rows by weekLabel
    const grouped = {};
    filtered.forEach(d => {
        const wl = d.weekLabel || 'Unknown Week';
        if (!grouped[wl]) grouped[wl] = [];
        grouped[wl].push(d);
    });

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ marginBottom: 22 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Delivery Status
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    End-to-end delivery tracker — dispatch routes and marketplace orders grouped by week.
                </p>
            </div>

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
                {[
                    { label: 'Total Records', value: allRecords.length, color: '#38bdf8', icon: '📦' },
                    { label: 'Active In-Flight', value: activeCount, color: '#fbbf24', icon: '🔵' },
                    { label: 'Delivered / Fulfilled', value: deliveredCount, color: '#a78bfa', icon: '🎉' },
                    { label: 'In Transit', value: inTransitCount, color: '#fb923c', icon: '🚚' },
                ].map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 18 }}>
                        <div style={{ fontSize: 20 }}>{k.icon}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color, margin: '6px 0 2px' }}>{k.value}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                <input
                    placeholder="Search vendor, restaurant, or order ID..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 270 }}
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
                {/* Status filters */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {allStatuses.map(s => {
                        const cfg = STATUS_CONFIG[s] || {};
                        const active = activeFilter === s;
                        return (
                            <button key={s} onClick={() => setActiveFilter(s)} style={{
                                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                background: active ? (cfg.bg || 'rgba(255,255,255,0.12)') : 'rgba(255,255,255,0.04)',
                                color: active ? (cfg.color || '#f8fafc') : '#94a3b8',
                                border: `1px solid ${active ? (cfg.color || '#f8fafc') : 'rgba(255,255,255,0.08)'}`,
                            }}>{s}</button>
                        );
                    })}
                </div>
            </div>

            {/* Grouped Table */}
            {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>⏳ Loading delivery status...</div>
            ) : filtered.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>🚛</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>No deliveries found</div>
                    <div style={{ fontSize: 13 }}>{activeFilter !== 'All' ? `No records with status "${activeFilter}".` : 'No delivery records yet.'}</div>
                </div>
            ) : (
                Object.entries(grouped).map(([weekLabel, rows]) => (
                    <div key={weekLabel} style={{ marginBottom: 28 }}>
                        {/* Week group header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8' }} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                                Week: {weekLabel}
                            </span>
                            <span style={{ fontSize: 12, color: '#64748b' }}>— {rows.length} record{rows.length > 1 ? 's' : ''}</span>
                        </div>

                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                            {['Source', 'Route Day', 'Vendor', 'Restaurant', 'Order ID', 'Delivery Status', 'Created', 'Confirmed', 'Delivered', 'Notes', ''].map(h => (
                                                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((d) => (
                                            <tr key={`${d.source}_${d.id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                <td style={{ padding: '11px 14px' }}><SourceBadge source={d.source} /></td>
                                                <td style={{ padding: '11px 14px' }}>
                                                    {d.routeDay && d.routeDay !== '—'
                                                        ? <RouteDayBadge routeDay={d.routeDay} size="small" />
                                                        : <span style={{ color: '#475569' }}>—</span>}
                                                </td>
                                                <td style={{ padding: '11px 14px', fontWeight: 600, color: '#f8fafc' }}>{d.vendorName}</td>
                                                <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12 }}>{d.restaurant}</td>
                                                <td style={{ padding: '11px 14px', color: '#475569', fontSize: 11, fontFamily: 'monospace', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.orderId}>{d.orderId?.slice(0, 22) || '—'}</td>
                                                <td style={{ padding: '11px 14px' }}><StatusBadge status={d.deliveryStatus} /></td>
                                                <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.sentAt)}</td>
                                                <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.confirmedAt)}</td>
                                                <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.deliveredAt)}</td>
                                                <td style={{ padding: '11px 14px', color: '#64748b', fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.notes}>{d.notes || '—'}</td>
                                                <td style={{ padding: '11px 14px' }}>
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
                        </div>
                    </div>
                ))
            )}

            <div style={{ marginTop: 16, background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10, padding: '12px 18px', fontSize: 13, color: '#94a3b8' }}>
                🚚 This page shows <strong style={{ color: '#38bdf8' }}>both</strong> vendor dispatch deliveries and marketplace order deliveries. Use the source filter to view them separately.
            </div>

            {raiseIssue && <RaiseIssueModal defaults={raiseIssue} onClose={() => setRaiseIssue(null)} />}
        </div>
    );
}
