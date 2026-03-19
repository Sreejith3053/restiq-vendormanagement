/**
 * VendorExpectedAllocation.js
 *
 * Vendor-facing weekly demand view.
 * Shows the vendor's Monday and Thursday order quantities for the active week
 * based on submitted restaurant orders, filtered to items this vendor carries.
 *
 * Data sources:
 *   - vendors/{vendorId}/items       → vendor's own catalog (allowed by rules)
 *   - submittedOrders (all)          → demand computation (filtered by item name match)
 */
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FiRefreshCw, FiTrendingUp, FiPackage, FiCalendar, FiAlertCircle,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { UserContext } from '../../contexts/UserContext';
import { db } from '../../firebase';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { getActiveWeekStart, formatWeekLabel } from '../Forecast/dispatchModel';

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };

function normalizeItemName(n) { return (n || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export default function VendorExpectedAllocation() {
    const navigate = useNavigate();
    const { vendorId, vendorName } = useContext(UserContext);

    const [myItems, setMyItems] = useState([]); // vendor's own catalog items
    const [demand, setDemand] = useState({}); // itemName → { mon, thu, branches: {} }
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    // Week navigation
    const [activeWeek, setActiveWeek] = useState(() => getActiveWeekStart());
    const weekLabel = useMemo(() => formatWeekLabel(activeWeek), [activeWeek]);
    const shiftWeek = (delta) => {
        const d = new Date(activeWeek);
        d.setDate(d.getDate() + delta * 7);
        setActiveWeek(d.toISOString().slice(0, 10));
    };

    // ── Step 1: load vendor's own catalog items ──────────────────────────────
    useEffect(() => {
        if (!vendorId) return;
        (async () => {
            try {
                const snap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                const items = snap.docs.map(d => ({
                    id: d.id,
                    name: d.data().name || '',
                    category: d.data().category || 'Produce',
                    vendorPrice: parseFloat(d.data().vendorPrice) || parseFloat(d.data().price) || 0,
                    unit: d.data().unit || '',
                    packQuantity: d.data().packQuantity || 1,
                })).filter(i => i.name);
                setMyItems(items);
            } catch (err) {
                console.error('[VendorAllocation] Failed to load items:', err);
                setLoadError('Could not load your catalog items.');
            }
        })();
    }, [vendorId]);

    // ── Step 2: real-time listener on submittedOrders, filter by item names ──
    useEffect(() => {
        if (!vendorId || myItems.length === 0) return;

        setLoading(true);
        setLoadError(null);

        const myItemNamesNorm = new Set(myItems.map(i => normalizeItemName(i.name)));

        const unsub = onSnapshot(collection(db, 'submittedOrders'), snap => {
            const allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const weekOrders = allOrders.filter(o => o.weekStart === activeWeek);

            const demandMap = {};

            weekOrders.forEach(order => {
                const restId = order.restaurantId || 'unknown';
                const restName = order.restaurantName || restId;
                const deliveryDay = order.deliveryDay || 'Monday';

                (order.items || []).forEach(line => {
                    const itemName = line.itemName;
                    if (!itemName) return;
                    if (!myItemNamesNorm.has(normalizeItemName(itemName))) return; // skip if not our item

                    const qty = Number(line.finalQty) || 0;
                    if (qty <= 0) return;

                    if (!demandMap[itemName]) {
                        demandMap[itemName] = { mon: 0, thu: 0, branches: {} };
                    }
                    if (deliveryDay === 'Monday') demandMap[itemName].mon += qty;
                    else demandMap[itemName].thu += qty;

                    if (!demandMap[itemName].branches[restId]) {
                        demandMap[itemName].branches[restId] = { name: restName, mon: 0, thu: 0 };
                    }
                    if (deliveryDay === 'Monday') demandMap[itemName].branches[restId].mon += qty;
                    else demandMap[itemName].branches[restId].thu += qty;
                });
            });

            setDemand(demandMap);
            setLoading(false);
        }, err => {
            console.error('[VendorAllocation] Listener error:', err);
            setLoadError('Could not load submitted orders data.');
            setLoading(false);
        });

        return () => unsub();
    }, [vendorId, myItems, activeWeek]);

    // ── Derived data ──────────────────────────────────────────────────────────
    const demandItems = useMemo(() => {
        return myItems
            .map(item => {
                const d = demand[item.name] || {};
                return {
                    ...item,
                    mon: d.mon || 0,
                    thu: d.thu || 0,
                    total: (d.mon || 0) + (d.thu || 0),
                    branches: Object.values(d.branches || {}).sort((a, b) => (b.mon + b.thu) - (a.mon + a.thu)),
                };
            })
            .filter(i => i.total > 0)
            .sort((a, b) => b.total - a.total);
    }, [myItems, demand]);

    const totalMon = demandItems.reduce((s, i) => s + i.mon, 0);
    const totalThu = demandItems.reduce((s, i) => s + i.thu, 0);
    const totalPacks = totalMon + totalThu;
    const [expandedItems, setExpandedItems] = useState(new Set());
    const toggleExpand = (name) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    };

    return (
        <div style={{ padding: 24, paddingBottom: 100 }}>
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.fg }}>📦 Combined Order Forecast</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
                        Your expected order quantities from submitted restaurant orders — Monday &amp; Thursday deliveries.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {/* Week Navigator */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
                        <button onClick={() => shiftWeek(-1)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>◀</button>
                        <div style={{ textAlign: 'center', minWidth: 150 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.fg }}>{weekLabel}</div>
                            <div style={{ fontSize: 10, color: C.muted }}>
                                {activeWeek === getActiveWeekStart() ? 'Current Week' : activeWeek}
                            </div>
                        </div>
                        <button onClick={() => shiftWeek(1)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>▶</button>
                    </div>
                    <button
                        onClick={() => { setLoading(true); setDemand({}); }}
                        disabled={loading}
                        style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                        <FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            {/* ERROR */}
            {loadError && (
                <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#f87171' }}>
                    <FiAlertCircle size={16} /> {loadError}
                </div>
            )}

            {/* LOADING */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                    <FiRefreshCw size={24} className="spin" style={{ marginBottom: 12 }} /><br />Loading demand data…
                </div>
            )}

            {!loading && (
                <>
                    {/* SUMMARY CARDS */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                        {[
                            { icon: <FiPackage size={16} />, value: demandItems.length, label: 'Items Ordered', color: C.blue },
                            { icon: <FiCalendar size={16} />, value: totalMon, label: 'Monday Units', color: '#3b82f6' },
                            { icon: <FiCalendar size={16} />, value: totalThu, label: 'Thursday Units', color: '#8b5cf6' },
                            { icon: <FiTrendingUp size={16} />, value: totalPacks, label: 'Total Units', color: C.green },
                        ].map(k => (
                            <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '16px 18px' }}>
                                <div style={{ color: k.color, marginBottom: 6 }}>{k.icon}</div>
                                <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{k.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* EMPTY STATE */}
                    {demandItems.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '60px 32px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 }}>
                            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6 }}>📭</div>
                            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>No Orders This Week</h3>
                            <p style={{ margin: '0 0 20px', color: C.muted, fontSize: 14, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>
                                No restaurant orders for your items have been submitted for <b>{weekLabel}</b>. Check back once restaurants submit their weekly orders.
                            </p>
                            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                                <button onClick={() => navigate('/vendor/capacity')} style={{
                                    padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.3)',
                                    background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                }}>🛡️ Update Capacity Plan</button>
                                <button onClick={() => navigate('/items')} style={{
                                    padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                                    background: 'transparent', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                }}>📋 Review Catalog Items</button>
                            </div>
                        </div>
                    )}

                    {/* DEMAND TABLE */}
                    {demandItems.length > 0 && (
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: 12, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}></th>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: 12, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Item</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', fontSize: 12, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Category</th>
                                        <th style={{ padding: '14px 20px', textAlign: 'center', fontSize: 12, color: '#3b82f6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, background: 'rgba(59,130,246,0.04)' }}>Monday</th>
                                        <th style={{ padding: '14px 20px', textAlign: 'center', fontSize: 12, color: '#8b5cf6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, background: 'rgba(139,92,246,0.04)' }}>Thursday</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'center', fontSize: 12, color: C.green, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Unit Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {demandItems.map((item, idx) => (
                                        <React.Fragment key={item.id || idx}>
                                            <tr
                                                style={{ borderTop: '1px solid rgba(255,255,255,0.05)', cursor: item.branches.length > 0 ? 'pointer' : 'default' }}
                                                onClick={() => item.branches.length > 0 && toggleExpand(item.name)}
                                            >
                                                <td style={{ padding: '12px 16px', textAlign: 'center', width: 36 }}>
                                                    {item.branches.length > 0 && (
                                                        <span style={{ color: C.muted, fontSize: 12 }}>
                                                            {expandedItems.has(item.name) ? '▼' : '▶'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 14, color: C.fg }}>{item.name}</td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <span style={{ background: 'rgba(56,189,248,0.1)', color: C.blue, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                                                        {item.category}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px 20px', textAlign: 'center', background: 'rgba(59,130,246,0.02)' }}>
                                                    {item.mon > 0 ? (
                                                        <span style={{ fontSize: 18, fontWeight: 800, color: '#3b82f6' }}>{item.mon}</span>
                                                    ) : (
                                                        <span style={{ color: C.muted, fontSize: 13 }}>—</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '12px 20px', textAlign: 'center', background: 'rgba(139,92,246,0.02)' }}>
                                                    {item.thu > 0 ? (
                                                        <span style={{ fontSize: 18, fontWeight: 800, color: '#8b5cf6' }}>{item.thu}</span>
                                                    ) : (
                                                        <span style={{ color: C.muted, fontSize: 13 }}>—</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                    <span style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{item.total}</span>
                                                    <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>{item.unit}</span>
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, color: C.amber, fontWeight: 600 }}>
                                                    {item.vendorPrice > 0 ? `$${item.vendorPrice.toFixed(2)}` : '—'}
                                                </td>
                                            </tr>

                                            {/* Branch Drill-down */}
                                            {expandedItems.has(item.name) && item.branches.length > 0 && (
                                                <tr style={{ borderTop: 'none' }}>
                                                    <td colSpan={7} style={{ padding: 0 }}>
                                                        <div style={{ padding: '12px 56px 20px', background: 'rgba(0,0,0,0.15)' }}>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Branch Breakdown</div>
                                                            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255,255,255,0.02)', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                                <thead>
                                                                    <tr>
                                                                        {['Restaurant', 'Monday', 'Thursday', 'Total'].map(h => (
                                                                            <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {item.branches.map((b, bi) => (
                                                                        <tr key={bi} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                                                            <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 500 }}>{b.name}</td>
                                                                            <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600, color: '#3b82f6' }}>{b.mon || '—'}</td>
                                                                            <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600, color: '#8b5cf6' }}>{b.thu || '—'}</td>
                                                                            <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 700 }}>{b.mon + b.thu}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                                {/* Totals row */}
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                                        <td colSpan={3} style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700, color: C.fg }}>
                                            Total — {demandItems.length} items
                                        </td>
                                        <td style={{ padding: '14px 20px', textAlign: 'center', fontSize: 16, fontWeight: 800, color: '#3b82f6', background: 'rgba(59,130,246,0.04)' }}>{totalMon}</td>
                                        <td style={{ padding: '14px 20px', textAlign: 'center', fontSize: 16, fontWeight: 800, color: '#8b5cf6', background: 'rgba(139,92,246,0.04)' }}>{totalThu}</td>
                                        <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: 16, fontWeight: 800, color: C.green }}>{totalPacks}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}

                    {/* FORECAST-TO-ACTION */}
                    {demandItems.length > 0 && (
                        <div style={{ marginTop: 20, padding: '16px 20px', background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8', marginBottom: 4 }}>⚡ Take Action on This Forecast</div>
                                <div style={{ fontSize: 13, color: '#94a3b8' }}>Update your capacity plan based on this week's demand to ensure readiness.</div>
                            </div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button onClick={() => navigate('/vendor/capacity')} style={{
                                    padding: '10px 20px', borderRadius: 8, border: 'none',
                                    background: '#38bdf8', color: '#0f172a', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                                }}>🛡️ Set Capacity from Forecast</button>
                                <button onClick={() => navigate('/dispatch-requests')} style={{
                                    padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                                    background: 'transparent', color: '#e2e8f0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                }}>📩 View Dispatch Requests</button>
                            </div>
                        </div>
                    )}

                    <div style={{ marginTop: 16, fontSize: 12, color: '#475569', fontStyle: 'italic', textAlign: 'center' }}>
                        Quantities are based on restaurant submitted orders for <b>{weekLabel}</b>. Data updates in real time.
                    </div>
                </>
            )}
        </div>
    );
}
