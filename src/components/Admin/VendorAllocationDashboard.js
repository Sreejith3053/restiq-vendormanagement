/**
 * VendorAllocationDashboard.js
 *
 * Admin dashboard showing how marketplace demand is distributed across vendors.
 * KPIs, allocation table by item×day, concentration risk, admin override panel,
 * and vendor share breakdown drawer.
 *
 * Data sources:
 *   - vendors/{id}/items → vendor catalog, prices
 *   - marketplaceOrders → demand computation (via fetchOrderHistory)
 *   - vendorAllocationEngine.allocateDemand() → allocation algorithm
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
    FiRefreshCw, FiDownload, FiSearch, FiX, FiChevronRight,
    FiAlertTriangle, FiCheckCircle, FiShield, FiActivity,
    FiTruck, FiEye, FiPieChart,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { fetchOrderHistory } from '../Forecast/forecastHelpers';
import {
    allocateDemand, supplyStabilityScore, ALLOCATION_CONFIG,
} from '../Vendors/vendorAllocationEngine';
import { calculateCompetitivenessScore, scoreLabel } from '../Vendors/vendorCompetitivenessEngine';

const C = {
    green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8',
    purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc',
};
const riskColor = { Low: C.green, Medium: C.amber, High: C.red, None: C.muted };

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeItemName(name) {
    if (!name) return '';
    return name.trim().replace(/\s+/g, ' ');
}

function getMedian(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

// ── Data Loading ──────────────────────────────────────────────────────────────

async function loadAllVendorItems() {
    const vendorsSnap = await getDocs(collection(db, 'vendors'));
    const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allItems = [];
    for (const v of vendors) {
        try {
            const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
            const vendorItemNames = itemSnap.docs.map(d => (d.data().name || '').trim());
            itemSnap.docs.forEach(d => {
                const data = d.data();
                const name = normalizeItemName(data.name);
                if (!name) return;
                const price = parseFloat(data.vendorPrice) || parseFloat(data.price) || 0;
                allItems.push({
                    vendorId: v.id,
                    vendorName: v.name || 'Unknown',
                    itemId: d.id,
                    itemName: name,
                    price,
                    category: data.category || 'Produce',
                    inStock: data.inStock !== false,
                    vendorItemNames,
                });
            });
        } catch (e) {
            console.warn('Failed to load items for vendor', v.id);
        }
    }
    return allItems;
}

function computeAllocations(allItems, orderRecords) {
    // 1. Group items by normalized name (across vendors)
    const itemGroups = {};
    allItems.forEach(item => {
        const key = item.itemName.toLowerCase();
        if (item.price <= 0) return;
        if (!itemGroups[key]) itemGroups[key] = { itemName: item.itemName, category: item.category, vendors: [] };
        itemGroups[key].vendors.push(item);
    });

    // 2. Compute demand per item per day from order history
    //    Use forecast logic: weekly average over last 12 weeks, split Mon/Thu
    const itemDemand = {}; // itemName (lower) → { monday: qty, thursday: qty }
    orderRecords.forEach(rec => {
        const key = rec.itemName.toLowerCase();
        if (!itemDemand[key]) itemDemand[key] = { total: 0, count: 0 };
        itemDemand[key].total += rec.qty;
        itemDemand[key].count++;
    });

    // Compute weekly averages (12 weeks of data)
    const weeklyDemand = {};
    Object.entries(itemDemand).forEach(([key, data]) => {
        const weeklyAvg = Math.round(data.total / 12); // ~12 weeks
        weeklyDemand[key] = {
            monday: Math.round(weeklyAvg * 0.6),   // Mon gets ~60%
            thursday: Math.round(weeklyAvg * 0.4),  // Thu gets ~40%
        };
    });

    // 3. For each item group with 1+ vendors and demand, run allocation
    const allAllocations = [];
    Object.entries(itemGroups).forEach(([key, group]) => {
        if (group.vendors.length < 1) return;
        const demand = weeklyDemand[key];
        if (!demand || (demand.monday + demand.thursday) === 0) return;

        // Compute competitiveness scores for each vendor
        const prices = group.vendors.map(v => v.price);
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        const med = getMedian(prices);

        const vendorsWithScores = group.vendors.map(v => {
            const scoreRecord = calculateCompetitivenessScore({
                vendorId: v.vendorId,
                vendorName: v.vendorName,
                itemId: v.itemId,
                itemName: group.itemName,
                comparableGroup: group.itemName.toLowerCase().replace(/\s+/g, '_'),
                normalizedPrice: v.price,
                lowestPrice: lowest,
                medianPrice: med,
                highestPrice: highest,
                vendorItemNames: v.vendorItemNames || [],
            });
            return {
                vendorId: v.vendorId,
                vendorName: v.vendorName,
                price: v.price,
                capacity: null, // No capacity limits in Firestore yet
                inStock: v.inStock,
                reliabilityScore: scoreRecord.reliabilityScore,
                competitivenessScore: scoreRecord.finalScore,
                isNewVendor: false,
            };
        });

        // Run allocations for Monday and Thursday
        ['Monday', 'Thursday'].forEach(day => {
            const qty = day === 'Monday' ? demand.monday : demand.thursday;
            if (qty <= 0) return;
            const result = allocateDemand({
                itemName: group.itemName,
                comparableGroup: group.itemName.toLowerCase().replace(/\s+/g, '_'),
                totalDemand: qty,
                deliveryDay: day,
                vendors: vendorsWithScores,
            });
            allAllocations.push(result);
        });
    });

    return allAllocations.sort((a, b) => b.totalDemand - a.totalDemand);
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function VendorAllocationDashboard() {
    const [search, setSearch] = useState('');
    const [selectedDay, setSelectedDay] = useState('All');
    const [drawerRow, setDrawerRow] = useState(null);
    const [loading, setLoading] = useState(true);
    const [allAllocations, setAllAllocations] = useState([]);

    const loadData = async () => {
        setLoading(true);
        try {
            const allItems = await loadAllVendorItems();
            console.log(`[Allocation] Loaded ${allItems.length} vendor items`);
            const orderRecords = await fetchOrderHistory(12);
            console.log(`[Allocation] Loaded ${orderRecords.length} order records`);
            const allocations = computeAllocations(allItems, orderRecords);
            console.log(`[Allocation] Computed ${allocations.length} allocations`);
            setAllAllocations(allocations);
        } catch (err) {
            console.error('[Allocation] Failed to load data:', err);
            toast.error('Failed to load allocation data');
        }
        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    const days = useMemo(() => ['All', ...new Set(allAllocations.map(a => a.deliveryDay).filter(Boolean))], [allAllocations]);

    const rows = useMemo(() => {
        let data = [...allAllocations];
        if (selectedDay !== 'All') data = data.filter(r => r.deliveryDay === selectedDay);
        if (search) {
            const q = search.toLowerCase();
            data = data.filter(r => `${r.itemName} ${r.comparableGroup} ${r.topVendor}`.toLowerCase().includes(q));
        }
        return data;
    }, [search, selectedDay, allAllocations]);

    // KPIs
    const totalDemandUnits = allAllocations.reduce((s, a) => s + a.totalDemand, 0);
    const totalAllocated = allAllocations.reduce((s, a) => s + a.allocations.reduce((ss, aa) => ss + aa.allocatedQuantity, 0), 0);
    const avgStability = allAllocations.length > 0 ? Math.round(allAllocations.reduce((s, a) => s + supplyStabilityScore(a.allocations), 0) / allAllocations.length) : 0;
    const highRiskCount = allAllocations.filter(a => a.concentrationRisk === 'High').length;
    const unallocatedTotal = allAllocations.reduce((s, a) => s + a.unallocated, 0);
    const groupsSet = new Set(allAllocations.map(a => a.comparableGroup));

    const kpis = [
        { label: 'Total Demand Units', value: loading ? '…' : totalDemandUnits, color: C.blue, icon: <FiTruck /> },
        { label: 'Allocated Units', value: loading ? '…' : totalAllocated, color: C.green, icon: <FiCheckCircle /> },
        { label: 'Unallocated', value: loading ? '…' : unallocatedTotal, color: unallocatedTotal > 0 ? C.red : C.green, icon: <FiAlertTriangle /> },
        { label: 'Avg Stability Score', value: loading ? '…' : `${avgStability}/100`, color: avgStability >= 70 ? C.green : C.amber, icon: <FiShield /> },
        { label: 'High Concentration Risk', value: loading ? '…' : highRiskCount, color: highRiskCount > 0 ? C.red : C.green, icon: <FiActivity /> },
        { label: 'Comparable Groups', value: loading ? '…' : groupsSet.size, color: C.purple, icon: <FiPieChart /> },
    ];

    const handleRefresh = () => { loadData(); toast.info('Recalculating allocations…'); };

    const thS = { padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
    const tdS = { padding: '12px 14px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)' };
    const trHover = { onMouseEnter: e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }, onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; }};

    return (
        <div style={{ padding: 24, paddingBottom: 100, position: 'relative' }}>
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: C.fg }}>📦 Vendor Order Allocation</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 14, maxWidth: 650 }}>
                        Automatic demand distribution across vendors based on competitiveness score, pricing, reliability, and capacity.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <FiSearch size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                        <input placeholder="Search item or vendor…" value={search} onChange={e => setSearch(e.target.value)} style={{
                            padding: '8px 12px 8px 32px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, width: 220, outline: 'none',
                        }} />
                    </div>
                    <button onClick={handleRefresh} disabled={loading} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Recalculate
                    </button>
                    <button onClick={() => toast.info('Export queued')} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.25)',
                        background: 'rgba(56,189,248,0.08)', color: C.blue, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <FiDownload size={14} /> Export
                    </button>
                </div>
            </div>

            {/* KPI CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 24 }}>
                {kpis.map(k => (
                    <div key={k.label} style={{
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 12, padding: '16px 18px', transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = `${k.color}44`}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'}
                    >
                        <div style={{ color: k.color, marginBottom: 8 }}>{k.icon}</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* LOADING */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                    <FiRefreshCw size={24} className="spin" style={{ marginBottom: 12 }} /><br />
                    Computing allocations from Firestore data…
                </div>
            )}

            {!loading && (
                <>
                    {/* PIPELINE POSITION INDICATOR */}
                    <div style={{ marginBottom: 24, padding: '14px 20px', background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8 }}>📋 Pipeline Position</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, flexWrap: 'wrap' }}>
                            {['Suggested Orders', 'Submitted Orders', 'Combined Demand'].map(s => (
                                <React.Fragment key={s}>
                                    <span style={{ color: C.muted }}>{s}</span>
                                    <span style={{ color: C.muted }}>→</span>
                                </React.Fragment>
                            ))}
                            <span style={{ color: C.blue, fontWeight: 700, padding: '2px 10px', background: 'rgba(56,189,248,0.15)', borderRadius: 6 }}>🔷 Vendor Allocation</span>
                            {['→', 'Vendor Dispatch', '→', 'Confirmations', '→', 'Warehouse', '→', 'Delivery'].map((s, i) => (
                                <span key={i} style={{ color: C.muted }}>{s}</span>
                            ))}
                        </div>
                    </div>

                    {/* DAY FILTER */}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                        {days.map(d => (
                            <button key={d} onClick={() => setSelectedDay(d)} style={{
                                padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                background: selectedDay === d ? C.blue : 'rgba(255,255,255,0.04)',
                                color: selectedDay === d ? '#0f172a' : C.muted,
                                border: `1px solid ${selectedDay === d ? C.blue : 'rgba(255,255,255,0.1)'}`,
                            }}>
                                {d}
                            </button>
                        ))}
                    </div>

                    {/* ALLOCATION TABLE + DRAWER */}
                    <div style={{ display: 'flex', gap: 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={thS}>Item</th><th style={thS}>Group</th><th style={thS}>Day</th>
                                            <th style={thS}>Demand</th><th style={thS}>Vendors</th><th style={thS}>Top Vendor</th>
                                            <th style={thS}>Allocation</th><th style={thS}>Stability</th><th style={thS}>Risk</th>
                                            <th style={thS}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r, idx) => {
                                            const stab = supplyStabilityScore(r.allocations);
                                            return (
                                                <tr key={idx} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                                    <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.itemName}</td>
                                                    <td style={tdS}><span style={{ background: 'rgba(148,163,184,0.1)', color: C.muted, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{r.comparableGroup}</span></td>
                                                    <td style={{ ...tdS, color: C.blue, fontWeight: 600 }}>{r.deliveryDay}</td>
                                                    <td style={{ ...tdS, fontWeight: 700, color: C.fg }}>{r.totalDemand}</td>
                                                    <td style={{ ...tdS, color: C.muted }}>{r.vendorCount}</td>
                                                    <td style={{ ...tdS, color: C.fg }}>{r.topVendor}</td>
                                                    <td style={tdS}>
                                                        <div style={{ display: 'flex', gap: 2, height: 14 }}>
                                                            {r.allocations.map((a, i) => {
                                                                const sl = scoreLabel(a.competitivenessScore);
                                                                return (
                                                                    <div key={i} title={`${a.vendorName}: ${a.allocatedQuantity} (${Math.round(a.allocationShare * 100)}%)`}
                                                                        style={{
                                                                            width: `${Math.max(8, a.allocationShare * 100)}%`,
                                                                            background: sl.color, borderRadius: 2, minWidth: 4,
                                                                        }}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    </td>
                                                    <td style={{ ...tdS, fontWeight: 700, color: stab >= 70 ? C.green : stab >= 50 ? C.amber : C.red }}>{stab}</td>
                                                    <td style={tdS}>
                                                        <span style={{ background: `${riskColor[r.concentrationRisk]}18`, color: riskColor[r.concentrationRisk], padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                                                            {r.concentrationRisk}
                                                        </span>
                                                    </td>
                                                    <td style={tdS}>
                                                        <button onClick={e => { e.stopPropagation(); setDrawerRow(r); }} style={{
                                                            background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
                                                            color: C.blue, padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                                        }}>
                                                            <FiEye size={12} /> View
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {rows.length === 0 && (
                                            <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: C.muted }}>No allocations match filters</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* DETAIL DRAWER */}
                        {drawerRow && <AllocationDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function AllocationDrawer({ row, onClose }) {
    const stab = supplyStabilityScore(row.allocations);

    return (
        <div style={{
            width: 400, minWidth: 400, borderLeft: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)',
            overflowY: 'auto', maxHeight: 'calc(100vh - 200px)', borderRadius: '0 12px 12px 0',
        }}>
            {/* Header */}
            <div style={{
                padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                position: 'sticky', top: 0, background: 'rgba(15,23,42,0.98)', zIndex: 2,
            }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>{row.itemName}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{row.comparableGroup} • {row.deliveryDay}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}><FiX size={18} /></button>
            </div>

            {/* Summary */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>📊 Allocation Summary</div>
                {[
                    ['Total Demand', `${row.totalDemand} units`, C.fg],
                    ['Vendors Allocated', row.vendorCount, C.blue],
                    ['Unallocated', row.unallocated, row.unallocated > 0 ? C.red : C.green],
                    ['Supply Stability', `${stab}/100`, stab >= 70 ? C.green : C.amber],
                    ['Concentration Risk', row.concentrationRisk, riskColor[row.concentrationRisk]],
                ].map(([l, v, c], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                        <span style={{ color: C.muted }}>{l}</span>
                        <span style={{ fontWeight: 600, color: c }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Vendor allocation breakdown */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>📦 Vendor Allocation Breakdown</div>
                {row.allocations.map((a, i) => {
                    const sl = scoreLabel(a.competitivenessScore);
                    return (
                        <div key={i} style={{
                            padding: '12px 14px', marginBottom: 8, background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                <span style={{ fontWeight: 700, color: C.fg, fontSize: 13 }}>{a.vendorName}</span>
                                <span style={{ fontWeight: 800, color: sl.color, fontSize: 15 }}>{a.allocatedQuantity} units</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                                <MicroBadge label="Share" value={`${Math.round(a.allocationShare * 100)}%`} color={C.blue} />
                                <MicroBadge label="Score" value={a.competitivenessScore} color={sl.color} />
                                <MicroBadge label="Price" value={`$${a.price.toFixed(2)}`} color={C.green} />
                                <MicroBadge label="Reliability" value={`${Math.round(a.reliability * 100)}%`} color={a.reliability >= 0.85 ? C.green : a.reliability >= 0.7 ? C.amber : C.red} />
                            </div>
                            {/* Share bar */}
                            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${a.allocationShare * 100}%`, background: sl.color, borderRadius: 3 }} />
                            </div>
                            {a.allocationReason && a.allocationReason !== 'Standard score-based allocation' && (
                                <div style={{ fontSize: 11, color: C.amber, marginTop: 6, fontStyle: 'italic' }}>
                                    ⚠ {a.allocationReason}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Marketplace Stability Rules */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>🔒 Marketplace Stability Rules</div>
                {[
                    ['Max Single Vendor', `${Math.round(ALLOCATION_CONFIG.maxSingleVendorShare * 100)}%`, C.fg],
                    ['Low Reliability Cap', `${Math.round(ALLOCATION_CONFIG.lowReliabilityCap * 100)}% (below ${Math.round(ALLOCATION_CONFIG.reliabilityThreshold * 100)}%)`, C.fg],
                    ['New Vendor Cap', `${Math.round(ALLOCATION_CONFIG.newVendorCap * 100)}% (first ${ALLOCATION_CONFIG.newVendorThresholdDays} days)`, C.fg],
                    ['Price Boost', `+${Math.round(ALLOCATION_CONFIG.priceBoostAmount * 100)}% if >${Math.round(ALLOCATION_CONFIG.priceBoostThreshold * 100)}% below median`, C.fg],
                ].map(([l, v, c], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                        <span style={{ color: C.muted }}>{l}</span>
                        <span style={{ fontWeight: 600, color: c }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Actions */}
            <div style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>Admin Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {['Override Vendor Allocation', 'Pause Vendor Supply', 'Boost Vendor Share', 'Set Vendor Max Share', 'Generate Dispatch Records'].map((a, i) => (
                        <button key={i} onClick={() => toast.info(`${a} — queued`)} style={{
                            width: '100%', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)',
                            color: C.blue, cursor: 'pointer', textAlign: 'left',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            <FiChevronRight size={14} /> {a}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

function MicroBadge({ label, value, color }) {
    return (
        <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: `${color}15`, color, whiteSpace: 'nowrap',
        }}>
            {label}: {value}
        </span>
    );
}
