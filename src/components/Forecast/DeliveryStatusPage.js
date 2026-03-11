import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { RouteDayBadge, RaiseIssueModal } from './DispatchShared';

const STATUS_CONFIG = {
    'Awaiting Confirmation': { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '⏳' },
    'Confirmed': { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '✅' },
    'Picking': { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', icon: '🔵' },
    'Loaded': { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', icon: '🚛' },
    'Out for Delivery': { color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: '🚚' },
    'Delivered': { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '🎉' },
    'Closed': { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '🔒' },
};

const DISPATCH_TO_DELIVERY = {
    'Sent': 'Awaiting Confirmation',
    'Confirmed': 'Confirmed',
    'Delivered': 'Delivered',
    'Closed': 'Closed',
};

function StatusBadge({ status, config }) {
    const cfg = config || STATUS_CONFIG[status] || STATUS_CONFIG['Awaiting Confirmation'];
    return (
        <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {cfg.icon} {status}
        </span>
    );
}

function fmt(ts) {
    if (!ts) return '—';
    if (ts?.toDate) return ts.toDate().toLocaleDateString('en-CA');
    const d = new Date(ts);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-CA');
}

function getRouteDays(d) {
    if (d.routeDay) return [d.routeDay];
    const days = [];
    if (d.mondaySent) days.push('Monday');
    if (d.thursdaySent) days.push('Thursday');
    return days.length ? days : null;
}

export default function DeliveryStatusPage() {
    const [dispatches, setDispatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('All');
    const [activeDay, setActiveDay] = useState('All');
    const [search, setSearch] = useState('');
    const [raiseIssue, setRaiseIssue] = useState(null);
    const unsubRef = useRef(null);

    useEffect(() => {
        unsubRef.current = onSnapshot(collection(db, 'vendorDispatchRoutes'), snap => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            docs.sort((a, b) => {
                const ta = a.sentAt ? new Date(a.sentAt) : 0;
                const tb = b.sentAt ? new Date(b.sentAt) : 0;
                return tb - ta;
            });
            setDispatches(docs);
            setLoading(false);
        }, err => { console.error(err); setLoading(false); });
        return () => unsubRef.current?.();
    }, []);

    const buildDeliveryStatus = (d) => DISPATCH_TO_DELIVERY[d.status] || 'Awaiting Confirmation';
    const allStatuses = ['All', ...Object.keys(STATUS_CONFIG)];

    const filtered = dispatches.filter(d => {
        const ds = buildDeliveryStatus(d);
        if (activeFilter !== 'All' && ds !== activeFilter) return false;
        if (activeDay !== 'All' && d.routeDay !== activeDay) return false;
        if (search) {
            const q = search.toLowerCase();
            return d.vendorName?.toLowerCase().includes(q)
                || (d.routeDispatchId || d.dispatchId)?.toLowerCase().includes(q)
                || d.weekLabel?.toLowerCase().includes(q);
        }
        return true;
    });

    const kpiCounts = {};
    Object.keys(STATUS_CONFIG).forEach(s => {
        kpiCounts[s] = dispatches.filter(d => buildDeliveryStatus(d) === s).length;
    });

    const activeCount = dispatches.filter(d => !['Delivered', 'Closed'].includes(d.status)).length;
    const deliveredCount = dispatches.filter(d => d.status === 'Delivered').length;

    // Group filtered rows by weekLabel for grouping display
    const grouped = {};
    filtered.forEach(d => {
        const wl = d.weekLabel || fmt(d.sentAt) || 'Unknown Week';
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
                    End-to-end dispatch execution tracker — grouped by week, with route day and dispatch ID visible on every row.
                </p>
            </div>

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
                {[
                    { label: 'Total Dispatches', value: dispatches.length, color: '#38bdf8', icon: '📦' },
                    { label: 'Active In-Flight', value: activeCount, color: '#fbbf24', icon: '🔵' },
                    { label: 'Delivered', value: deliveredCount, color: '#a78bfa', icon: '🎉' },
                    { label: 'Awaiting Confirmation', value: kpiCounts['Awaiting Confirmation'] || 0, color: '#fbbf24', icon: '⏳' },
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
                    placeholder="Search vendor, dispatch ID, or week..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 270 }}
                />
                {/* Route Day filter */}
                <div style={{ display: 'flex', gap: 6 }}>
                    {['All', 'Monday', 'Thursday'].map(d => (
                        <button key={d} onClick={() => setActiveDay(d)} style={{
                            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            background: activeDay === d ? (d === 'Monday' ? 'rgba(129,140,248,0.15)' : d === 'Thursday' ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.1)') : 'rgba(255,255,255,0.04)',
                            color: activeDay === d ? (d === 'Monday' ? '#818cf8' : d === 'Thursday' ? '#a78bfa' : '#f8fafc') : '#94a3b8',
                            border: `1px solid ${activeDay === d ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
                        }}>
                            {d === 'All' ? 'Both Routes' : `📅 ${d}`}
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
                    <div style={{ fontSize: 13 }}>{activeFilter !== 'All' ? `No dispatches with status "${activeFilter}".` : 'No dispatch records yet.'}</div>
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
                            <span style={{ fontSize: 12, color: '#64748b' }}>— {rows.length} dispatch{rows.length > 1 ? 'es' : ''}</span>
                        </div>

                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                            {['Route Day', 'Vendor', 'Dispatch ID', 'Dispatch Status', 'Delivery Status', 'Sent', 'Confirmed', 'Delivered', 'Notes', ''].map(h => (
                                                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((d) => {
                                            const deliveryStatus = buildDeliveryStatus(d);
                                            const dCfg = STATUS_CONFIG[d.status] || {};
                                            const deliveryCfg = STATUS_CONFIG[deliveryStatus] || {};
                                            const routeDays = getRouteDays(d);
                                            return (
                                                <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                    <td style={{ padding: '11px 14px' }}>
                                                        {d.routeDay
                                                            ? <RouteDayBadge routeDay={d.routeDay} size="small" />
                                                            : <span style={{ color: '#475569' }}>—</span>}
                                                    </td>
                                                    <td style={{ padding: '11px 14px', fontWeight: 600, color: '#f8fafc' }}>{d.vendorName || '—'}</td>
                                                    <td style={{ padding: '11px 14px', color: '#475569', fontSize: 11, fontFamily: 'monospace', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.routeDispatchId || d.dispatchId || d.id}>{(d.routeDispatchId || d.dispatchId || d.id)?.slice(0, 22) || '—'}</td>
                                                    <td style={{ padding: '11px 14px' }}>
                                                        <span style={{ background: dCfg.bg || 'rgba(255,255,255,0.06)', color: dCfg.color || '#94a3b8', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                                                            {d.status || 'Draft'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '11px 14px' }}><StatusBadge status={deliveryStatus} config={deliveryCfg} /></td>
                                                    <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.sentAt)}</td>
                                                    <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.confirmedAt)}</td>
                                                    <td style={{ padding: '11px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.deliveredAt)}</td>
                                                    <td style={{ padding: '11px 14px', color: '#64748b', fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.confirmationNotes || d.rejectionReason}>{d.confirmationNotes || d.rejectionReason || '—'}</td>
                                                    <td style={{ padding: '11px 14px' }}>
                                                        <button onClick={() => setRaiseIssue({
                                                            dispatchId: d.routeDispatchId || d.dispatchId || d.id,
                                                            vendorId: d.vendorId || '',
                                                            vendorName: d.vendorName || '',
                                                            restaurantId: d.restaurantId || '',
                                                            restaurantName: d.restaurantName || '',
                                                            routeDay: d.routeDay || 'Monday',
                                                        })}
                                                            style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(244,63,94,0.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)', whiteSpace: 'nowrap' }}>
                                                            🚨 Issue
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ))
            )}

            <div style={{ marginTop: 16, background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10, padding: '12px 18px', fontSize: 13, color: '#94a3b8' }}>
                🚚 Workflow: Vendor Dispatch → Dispatch Confirmations → Warehouse Pick List → <strong style={{ color: '#38bdf8' }}>Delivery Status</strong> → Invoices
            </div>

            {raiseIssue && <RaiseIssueModal defaults={raiseIssue} onClose={() => setRaiseIssue(null)} />}
        </div>
    );
}
