import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { RouteDayBadge, RaiseIssueModal } from './DispatchShared';

const PICK_STATUS = {
    Pending: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
    Picked: { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
    Loaded: { color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
};

const ZONES = { Produce: 'Zone A', Packaging: 'Zone B', Spices: 'Zone C', Meat: 'Zone D', Dairy: 'Zone E', 'Cleaning Supplies': 'Zone F' };

// ── Inclusion rule: Confirmed + Partially Confirmed + Delivered enter warehouse ─
const WAREHOUSE_STATUSES = ['Confirmed', 'Partially Confirmed', 'Delivered'];

export default function WarehousePickListPage() {
    const [allDispatches, setAllDispatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeDay, setActiveDay] = useState('Monday');
    const [pickStatus, setPickStatus] = useState({});
    const [raiseIssue, setRaiseIssue] = useState(null);
    const unsubRef = useRef(null);

    useEffect(() => {
        unsubRef.current = onSnapshot(collection(db, 'vendorDispatchRoutes'), snap => {
            const docs = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                // Inclusion rule: only Confirmed | Partially Confirmed | Delivered
                .filter(d => WAREHOUSE_STATUSES.includes(d.status));
            setAllDispatches(docs);
            setLoading(false);
        }, err => { console.error(err); setLoading(false); });
        return () => unsubRef.current?.();
    }, []);

    // Included = Confirmed/Partially Confirmed/Delivered
    const includedDispatches = allDispatches.filter(d => WAREHOUSE_STATUSES.includes(d.status));
    // Excluded = non-warehouse-eligible route records this week
    const excludedDispatches = allDispatches
        .filter(d => !WAREHOUSE_STATUSES.includes(d.status) && d.status && d.status !== 'Closed')
        .concat(
            // Also show parent dispatches still in Sent state
            []
        );

    // Build pick rows — each vendorDispatchRoutes record is already for one routeDay
    const pickRows = [];
    includedDispatches
        .filter(d => d.routeDay === activeDay) // Only show rows for active route day
        .forEach(dispatch => {
            (dispatch.items || []).forEach(item => {
                const qty = item.qty || item.mondayQty || item.thursdayQty || 0;
                if (!qty) return;
                pickRows.push({
                    key: `${dispatch.id}-${item.itemId || item.itemName}`,
                    itemName: item.itemName,
                    vendor: dispatch.vendorName,
                    vendorId: dispatch.vendorId || '',
                    dispatchId: dispatch.routeDispatchId || dispatch.dispatchId || dispatch.id,
                    routeDispatchId: dispatch.routeDispatchId || dispatch.id,
                    restaurantId: dispatch.restaurantId || '',
                    restaurantName: dispatch.restaurantName || '',
                    category: item.category || 'Produce',
                    zone: ZONES[item.category] || 'Zone A',
                    qty,
                    packLabel: item.packLabel || '—',
                    routeDay: dispatch.routeDay || activeDay,
                    weekLabel: dispatch.weekLabel || '',
                });
            });
        });

    pickRows.sort((a, b) => a.zone.localeCompare(b.zone) || a.itemName.localeCompare(b.itemName));

    const toggleStatus = (key) => {
        setPickStatus(prev => {
            const cur = prev[key] || 'Pending';
            const next = cur === 'Pending' ? 'Picked' : cur === 'Picked' ? 'Loaded' : 'Pending';
            return { ...prev, [key]: next };
        });
    };

    const totalQty = pickRows.reduce((s, r) => s + r.qty, 0);
    const loadedCount = pickRows.filter(r => (pickStatus[r.key] || 'Pending') === 'Loaded').length;
    const pickedCount = pickRows.filter(r => (pickStatus[r.key] || 'Pending') === 'Picked').length;
    const pendingCount = pickRows.length - loadedCount - pickedCount;

    const byZone = {};
    pickRows.forEach(r => {
        if (!byZone[r.zone]) byZone[r.zone] = [];
        byZone[r.zone].push(r);
    });

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto', color: '#f8fafc', paddingBottom: 80 }}>
            {/* Header */}
            <div style={{ marginBottom: 22 }}>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0', background: 'linear-gradient(90deg,#f8fafc,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    Warehouse Pick List
                </h1>
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                    Operational pick requirements for <strong style={{ color: '#34d399' }}>Confirmed</strong> vendor dispatches. Tap status to advance. Unconfirmed dispatches are excluded.
                </p>
            </div>

            {/* Day Toggle */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                {['Monday', 'Thursday'].map(d => (
                    <button key={d} onClick={() => setActiveDay(d)} style={{
                        padding: '10px 28px', borderRadius: 24, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                        background: activeDay === d ? (d === 'Monday' ? 'rgba(129,140,248,0.15)' : 'rgba(167,139,250,0.15)') : 'rgba(255,255,255,0.04)',
                        color: activeDay === d ? (d === 'Monday' ? '#818cf8' : '#a78bfa') : '#94a3b8',
                        border: `1px solid ${activeDay === d ? (d === 'Monday' ? 'rgba(129,140,248,0.35)' : 'rgba(167,139,250,0.35)') : 'rgba(255,255,255,0.08)'}`,
                    }}>
                        📅 {d} Route
                    </button>
                ))}
            </div>

            {/* Excluded vendors banner */}
            {excludedDispatches.length > 0 && (
                <div style={{ marginBottom: 18, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)', borderRadius: 10, padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 6 }}>⚠️ Excluded from Pick List — Awaiting Confirmation</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {excludedDispatches.map(d => (
                            <span key={d.id} style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                                {d.vendorName || d.dispatchId || d.id} · <span style={{ opacity: 0.75 }}>{d.status}</span>
                            </span>
                        ))}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                        These dispatches are not yet Confirmed and will not appear in the pick list. Ask vendors to confirm, or confirm manually in Dispatch Confirmations.
                    </div>
                </div>
            )}

            {/* KPI Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                {[
                    { label: 'Total Line Items', value: pickRows.length, color: '#38bdf8', icon: '📋' },
                    { label: 'Total Qty', value: totalQty, color: '#f8fafc', icon: '📦' },
                    { label: 'Pending', value: pendingCount, color: '#fbbf24', icon: '⏳' },
                    { label: 'Picked / Loaded', value: `${pickedCount} / ${loadedCount}`, color: '#34d399', icon: '✅' },
                ].map(k => (
                    <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 18 }}>
                        <div>{k.icon}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color, margin: '6px 0 2px' }}>{k.value}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>⏳ Loading pick list...</div>
            ) : pickRows.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 6 }}>No confirmed dispatches for {activeDay} route</div>
                    <div style={{ fontSize: 13 }}>Only Confirmed or Partially Confirmed dispatches appear here. Confirm dispatches in Dispatch Confirmations to generate pick rows.</div>
                </div>
            ) : (
                Object.entries(byZone).map(([zone, rows]) => (
                    <div key={zone} style={{ marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8' }} />
                            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 1 }}>{zone}</h3>
                            <span style={{ fontSize: 12, color: '#64748b' }}>— {rows.length} items</span>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                        {['Item', 'Vendor', 'Dispatch ID', 'Route', 'Pack Size', 'Qty', 'Status', ''].map(h => (
                                            <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => {
                                        const st = pickStatus[row.key] || 'Pending';
                                        const cfg = PICK_STATUS[st];
                                        return (
                                            <tr key={row.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                <td style={{ padding: '11px 14px', fontWeight: 600, color: st === 'Loaded' ? '#94a3b8' : '#f8fafc', textDecoration: st === 'Loaded' ? 'line-through' : 'none' }}>{row.itemName}</td>
                                                <td style={{ padding: '11px 14px', color: '#94a3b8' }}>{row.vendor}</td>
                                                <td style={{ padding: '11px 14px', color: '#475569', fontSize: 11, fontFamily: 'monospace', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.dispatchId}>{row.dispatchId?.slice(0, 20) || '—'}</td>
                                                <td style={{ padding: '11px 14px' }}><RouteDayBadge routeDay={row.routeDay} size="small" /></td>
                                                <td style={{ padding: '11px 14px', color: '#64748b', fontSize: 12 }}>{row.packLabel}</td>
                                                <td style={{ padding: '11px 14px', fontWeight: 700, color: '#f8fafc' }}>{row.qty}</td>
                                                <td style={{ padding: '11px 14px' }}>
                                                    <button onClick={() => toggleStatus(row.key)} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}44`, padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                                        {st}
                                                    </button>
                                                </td>
                                                <td style={{ padding: '11px 14px' }}>
                                                    <button onClick={() => setRaiseIssue({
                                                        dispatchId: row.dispatchId,
                                                        vendorId: row.vendorId,
                                                        vendorName: row.vendor,
                                                        restaurantId: row.restaurantId,
                                                        restaurantName: row.restaurantName,
                                                        itemName: row.itemName,
                                                        routeDay: row.routeDay,
                                                    })}
                                                        style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(244,63,94,0.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)', whiteSpace: 'nowrap' }}>
                                                        🚨
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))
            )}

            <div style={{ marginTop: 8, background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10, padding: '12px 18px', fontSize: 13, color: '#94a3b8' }}>
                📦 <strong style={{ color: '#34d399' }}>Inclusion rule:</strong> Only Confirmed / Partially Confirmed dispatches generate pick rows. Unconfirmed dispatches show in the yellow exclusion banner above.
            </div>

            {raiseIssue && <RaiseIssueModal defaults={raiseIssue} onClose={() => setRaiseIssue(null)} />}
        </div>
    );
}
