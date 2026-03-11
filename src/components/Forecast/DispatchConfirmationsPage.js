import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { RouteDayBadge, RaiseIssueModal } from './DispatchShared';

const STATUSES = ['All', 'Sent', 'Confirmed', 'Partially Confirmed', 'Rejected', 'Delivered', 'Closed'];

const STATUS_CONFIG = {
    Sent: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', icon: '📤' },
    Confirmed: { color: '#34d399', bg: 'rgba(52,211,153,0.12)', icon: '✅' },
    'Partially Confirmed': { color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: '⚠️' },
    Rejected: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: '❌' },
    Delivered: { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '🎉' },
    Closed: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', icon: '🔒' },
    Draft: { color: '#64748b', bg: 'rgba(100,116,139,0.1)', icon: '📋' },
};

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

// Derive routeDay from dispatch record: prefer explicit field, fall back to booleans
function getRouteDays(d) {
    if (d.routeDay) return [d.routeDay];
    const days = [];
    if (d.mondaySent) days.push('Monday');
    if (d.thursdaySent) days.push('Thursday');
    return days.length ? days : ['—'];
}

export default function DispatchConfirmationsPage() {
    const [dispatches, setDispatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeStatus, setActiveStatus] = useState('All');
    const [activeDay, setActiveDay] = useState('All');
    const [search, setSearch] = useState('');
    const [raiseIssue, setRaiseIssue] = useState(null); // holds defaults for modal
    const unsubRef = useRef(null);

    useEffect(() => {
        setLoading(true);
        unsubRef.current = onSnapshot(
            collection(db, 'vendorDispatchRoutes'),
            (snap) => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                docs.sort((a, b) => {
                    const ta = a.sentAt ? new Date(a.sentAt) : 0;
                    const tb = b.sentAt ? new Date(b.sentAt) : 0;
                    return tb - ta;
                });
                setDispatches(docs);
                setLoading(false);
            },
            (err) => { console.error('Dispatch confirmations error:', err); setLoading(false); }
        );
        return () => unsubRef.current?.();
    }, []);

    const filtered = dispatches.filter(d => {
        if (activeStatus !== 'All' && d.status !== activeStatus) return false;
        if (activeDay !== 'All' && d.routeDay !== activeDay) return false;
        if (search) {
            const q = search.toLowerCase();
            return d.vendorName?.toLowerCase().includes(q)
                || d.routeDispatchId?.toLowerCase().includes(q)
                || d.dispatchId?.toLowerCase().includes(q)
                || d.weekLabel?.toLowerCase().includes(q)
                || d.routeDay?.toLowerCase().includes(q);
        }
        return true;
    });

    const counts = {};
    STATUSES.slice(1).forEach(s => { counts[s] = dispatches.filter(d => d.status === s).length; });

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Dispatch Confirmations
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    Track vendor responses to weekly dispatch orders — from Sent to Delivered. Each row shows the route day clearly.
                </p>
            </div>

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
                {STATUSES.slice(1).map(s => {
                    const cfg = STATUS_CONFIG[s];
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
                    placeholder="Search vendor, dispatch ID, or week..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', outline: 'none', fontSize: 13, width: 280 }}
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
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>⏳ Loading dispatch records...</div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>No dispatches found</div>
                        <div style={{ fontSize: 13 }}>
                            {activeStatus !== 'All' ? `No dispatches with status "${activeStatus}".` : 'No dispatch records exist yet. Send orders from Vendor Dispatch to see them here.'}
                        </div>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                    {['Route Day', 'Vendor', 'Dispatch ID', 'Week', 'Status', 'Sent', 'Confirmed', 'Delivered', 'Notes', ''].map(h => (
                                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((d) => {
                                    const routeDays = getRouteDays(d);
                                    return (
                                        <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '12px 14px' }}>
                                                {d.routeDay
                                                    ? <RouteDayBadge routeDay={d.routeDay} size="small" />
                                                    : <span style={{ color: '#475569' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '12px 14px', fontWeight: 600, color: '#f8fafc' }}>{d.vendorName || '—'}</td>
                                            <td style={{ padding: '12px 14px', color: '#64748b', fontSize: 11, fontFamily: 'monospace', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.routeDispatchId || d.dispatchId}>{(d.routeDispatchId || d.dispatchId)?.slice(0, 24) || '—'}</td>
                                            <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>{d.weekLabel || '—'}</td>
                                            <td style={{ padding: '12px 14px' }}><StatusBadge status={d.status || 'Draft'} /></td>
                                            <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.sentAt)}</td>
                                            <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.confirmedAt)}</td>
                                            <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12 }}>{fmt(d.deliveredAt)}</td>
                                            <td style={{ padding: '12px 14px', color: '#94a3b8', fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.confirmationNotes || d.rejectionReason}>{d.confirmationNotes || d.rejectionReason || '—'}</td>
                                            <td style={{ padding: '12px 14px' }}>
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
                )}
            </div>

            {/* Inclusion rule note */}
            <div style={{ marginTop: 16, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: 10, padding: '11px 16px', fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>ℹ️</span>
                <span><strong style={{ color: '#fbbf24' }}>Warehouse Inclusion Rule:</strong> Only <strong>Confirmed</strong> or <strong>Partially Confirmed</strong> dispatches generate warehouse pick rows. Dispatches still showing <em>Sent</em> will not appear in the Warehouse Pick List until confirmed.</span>
            </div>

            {/* Workflow hint */}
            <div style={{ marginTop: 10, background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10, padding: '12px 18px', fontSize: 13, color: '#94a3b8' }}>
                📦 Workflow: <strong style={{ color: '#38bdf8' }}>Vendor Dispatch</strong> → <strong style={{ color: '#38bdf8' }}>Dispatch Confirmations</strong> → Warehouse Pick List → Delivery Status → Invoices
            </div>

            {raiseIssue && <RaiseIssueModal defaults={raiseIssue} onClose={() => setRaiseIssue(null)} />}
        </div>
    );
}
