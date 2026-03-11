/**
 * SupplyCapacityDashboard.js
 *
 * Admin dashboard — Supply Capacity Forecast.
 * KPIs, pipeline position, capacity table, shortage alerts, detail drawer.
 */
import React, { useState, useMemo } from 'react';
import {
    FiRefreshCw, FiDownload, FiSearch, FiX, FiChevronRight,
    FiAlertTriangle, FiCheckCircle, FiShield, FiActivity,
    FiTruck, FiEye, FiPackage, FiTrendingUp,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import {
    generateMockCapacityForecast, supplyHealthLabel,
} from '../Vendors/supplyCapacityEngine';

const ALL_FORECASTS = generateMockCapacityForecast();
const CATEGORIES = ['All', ...new Set(ALL_FORECASTS.map(f => f.category).filter(Boolean))];
const HEALTH_OPTIONS = ['All', 'Healthy', 'Watch', 'Tight', 'Shortage Risk', 'Excess Capacity'];

const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', orange: '#fb923c', muted: '#94a3b8', fg: '#f8fafc' };

export default function SupplyCapacityDashboard() {
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [selectedHealth, setSelectedHealth] = useState('All');
    const [drawerRow, setDrawerRow] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const rows = useMemo(() => {
        let data = [...ALL_FORECASTS];
        if (selectedCategory !== 'All') data = data.filter(r => r.category === selectedCategory);
        if (selectedHealth !== 'All') data = data.filter(r => r.supplyHealthStatus === selectedHealth);
        if (search) { const q = search.toLowerCase(); data = data.filter(r => `${r.itemName} ${r.comparableGroup}`.toLowerCase().includes(q)); }
        // Sort: shortage first, then tight, then others
        const order = { 'Shortage Risk': 0, Tight: 1, Watch: 2, Healthy: 3, 'Excess Capacity': 4 };
        data.sort((a, b) => (order[a.supplyHealthStatus] ?? 5) - (order[b.supplyHealthStatus] ?? 5));
        return data;
    }, [search, selectedCategory, selectedHealth]);

    const healthy = ALL_FORECASTS.filter(f => f.supplyHealthStatus === 'Healthy').length;
    const tight = ALL_FORECASTS.filter(f => f.supplyHealthStatus === 'Tight' || f.supplyHealthStatus === 'Watch').length;
    const shortage = ALL_FORECASTS.filter(f => f.supplyHealthStatus === 'Shortage Risk').length;
    const excess = ALL_FORECASTS.filter(f => f.supplyHealthStatus === 'Excess Capacity').length;
    const totalDemand = ALL_FORECASTS.reduce((s, f) => s + f.weeklyForecastDemand, 0);
    const totalCap = ALL_FORECASTS.reduce((s, f) => s + f.weeklyCapacity, 0);

    const kpis = [
        { label: 'Healthy Supply', value: healthy, color: C.green, icon: <FiCheckCircle /> },
        { label: 'Tight / Watch', value: tight, color: C.amber, icon: <FiShield /> },
        { label: 'Shortage Risk', value: shortage, color: C.red, icon: <FiAlertTriangle /> },
        { label: 'Excess Capacity', value: excess, color: C.purple, icon: <FiTrendingUp /> },
        { label: 'Total Demand', value: totalDemand, color: C.blue, icon: <FiTruck /> },
        { label: 'Total Capacity', value: totalCap, color: C.cyan, icon: <FiPackage /> },
    ];

    const handleRefresh = () => { setRefreshing(true); setTimeout(() => { setRefreshing(false); toast.success('Capacity forecast recalculated'); }, 800); };

    const thS = { padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
    const tdS = { padding: '12px 14px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)' };
    const trHover = { onMouseEnter: e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }, onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; }};

    return (
        <div style={{ padding: 24, paddingBottom: 100, position: 'relative' }}>
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: C.fg }}>🛡️ Supply Capacity Forecast</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 14, maxWidth: 650 }}>
                        Compare next-week forecasted demand against vendor supply capacity. Detect shortages, tight supply, and growth opportunities before orders are finalized.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <FiSearch size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                        <input placeholder="Search item…" value={search} onChange={e => setSearch(e.target.value)} style={{
                            padding: '8px 12px 8px 32px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, width: 200, outline: 'none',
                        }} />
                    </div>
                    <button onClick={handleRefresh} disabled={refreshing} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}><FiRefreshCw size={14} /> Recalculate</button>
                    <button onClick={() => toast.info('Export queued')} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.25)',
                        background: 'rgba(56,189,248,0.08)', color: C.blue, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}><FiDownload size={14} /> Export</button>
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

            {/* PIPELINE POSITION */}
            <div style={{ marginBottom: 24, padding: '14px 20px', background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)', borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8 }}>📋 Pipeline Position</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, flexWrap: 'wrap' }}>
                    <span>Forecast Engine</span><span>→</span>
                    <span style={{ color: C.green, fontWeight: 700, padding: '2px 10px', background: 'rgba(52,211,153,0.15)', borderRadius: 6 }}>🛡️ Supply Capacity Forecast</span>
                    {['→', 'Suggested Orders', '→', 'Submitted Orders', '→', 'Combined Demand', '→', 'Vendor Allocation', '→', 'Dispatch'].map((s, i) => (
                        <span key={i} style={{ color: C.muted }}>{s}</span>
                    ))}
                </div>
            </div>

            {/* SHORTAGE ALERTS */}
            {ALL_FORECASTS.some(f => f.alerts.length > 0) && (
                <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.fg, marginBottom: 10 }}>🚨 Supply Alerts</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {ALL_FORECASTS.flatMap(f => f.alerts).slice(0, 6).map((a, i) => {
                            const ac = a.severity === 'critical' ? C.red : a.severity === 'warning' ? C.amber : C.purple;
                            return (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                                    background: `${ac}08`, border: `1px solid ${ac}20`, borderRadius: 10,
                                }}>
                                    <span style={{ fontSize: 16 }}>{a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🟣'}</span>
                                    <span style={{ fontSize: 13, color: '#cbd5e1', flex: 1 }}>{a.text}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* FILTERS */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
                {CATEGORIES.map(cat => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} style={{
                        padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: selectedCategory === cat ? C.blue : 'rgba(255,255,255,0.04)',
                        color: selectedCategory === cat ? '#0f172a' : C.muted,
                        border: `1px solid ${selectedCategory === cat ? C.blue : 'rgba(255,255,255,0.1)'}`,
                    }}>{cat}</button>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {HEALTH_OPTIONS.map(h => (
                        <button key={h} onClick={() => setSelectedHealth(h)} style={{
                            padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            background: selectedHealth === h ? 'rgba(56,189,248,0.15)' : 'transparent',
                            color: selectedHealth === h ? C.blue : C.muted,
                            border: `1px solid ${selectedHealth === h ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.08)'}`,
                        }}>{h}</button>
                    ))}
                </div>
            </div>

            {/* TABLE + DRAWER */}
            <div style={{ display: 'flex', gap: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={thS}>Item</th><th style={thS}>Category</th><th style={thS}>Demand</th>
                                    <th style={thS}>Capacity</th><th style={thS}>Gap</th><th style={thS}>Status</th>
                                    <th style={thS}>Mon</th><th style={thS}>Thu</th><th style={thS}>Vendors</th>
                                    <th style={thS}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, idx) => {
                                    const hl = supplyHealthLabel(r.capacityGapPct);
                                    return (
                                        <tr key={idx} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                            <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.itemName}</td>
                                            <td style={tdS}><span style={{ background: 'rgba(148,163,184,0.1)', color: C.muted, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{r.category}</span></td>
                                            <td style={{ ...tdS, fontWeight: 700, color: C.fg }}>{r.weeklyForecastDemand}</td>
                                            <td style={{ ...tdS, fontWeight: 700, color: C.blue }}>{r.weeklyCapacity}</td>
                                            <td style={{ ...tdS, fontWeight: 700, color: r.capacityGap >= 0 ? C.green : C.red }}>
                                                {r.capacityGap >= 0 ? '+' : ''}{r.capacityGap}
                                            </td>
                                            <td style={tdS}>
                                                <span style={{ background: `${hl.color}22`, color: hl.color, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                                                    {hl.icon} {hl.text}
                                                </span>
                                            </td>
                                            <td style={{ ...tdS, fontSize: 12 }}>
                                                <span style={{ color: supplyHealthLabel(r.mondayCapacity > 0 && r.mondayForecastDemand > 0 ? (r.mondayCapacity - Math.ceil(r.mondayForecastDemand * (1 + r.safetyMargin))) / Math.ceil(r.mondayForecastDemand * (1 + r.safetyMargin)) : 1).color }}>
                                                    {r.mondayHealth}
                                                </span>
                                            </td>
                                            <td style={{ ...tdS, fontSize: 12 }}>
                                                <span style={{ color: supplyHealthLabel(r.thursdayCapacity > 0 && r.thursdayForecastDemand > 0 ? (r.thursdayCapacity - Math.ceil(r.thursdayForecastDemand * (1 + r.safetyMargin))) / Math.ceil(r.thursdayForecastDemand * (1 + r.safetyMargin)) : 1).color }}>
                                                    {r.thursdayHealth}
                                                </span>
                                            </td>
                                            <td style={{ ...tdS, color: C.muted }}>{r.activeVendorCount}</td>
                                            <td style={tdS}>
                                                <button onClick={e => { e.stopPropagation(); setDrawerRow(r); }} style={{
                                                    background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
                                                    color: C.blue, padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                                }}><FiEye size={12} /> View</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {rows.length === 0 && (
                                    <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: C.muted }}>No items match filters</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {drawerRow && <CapacityDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />}
            </div>
        </div>
    );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function CapacityDrawer({ row, onClose }) {
    const hl = supplyHealthLabel(row.capacityGapPct);

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
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{row.comparableGroup} • {row.category}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}><FiX size={18} /></button>
            </div>

            {/* Health status */}
            <div style={{ padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                <div style={{ fontSize: 36, fontWeight: 900, color: hl.color }}>{hl.icon} {hl.text}</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
                    Week of <strong style={{ color: C.fg }}>{row.weekStart}</strong>
                </div>
            </div>

            {/* Demand vs Capacity */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>📊 Demand vs Capacity</div>
                {[
                    ['Weekly Demand', row.weeklyForecastDemand, C.fg],
                    ['Safety Margin', `${Math.round(row.safetyMargin * 100)}%`, C.muted],
                    ['Safety-Adjusted Demand', row.safetyAdjustedDemand, C.amber],
                    ['Total Vendor Capacity', row.weeklyCapacity, C.blue],
                    ['Capacity Gap', `${row.capacityGap >= 0 ? '+' : ''}${row.capacityGap}`, row.capacityGap >= 0 ? C.green : C.red],
                ].map(([l, v, c], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                        <span style={{ color: C.muted }}>{l}</span>
                        <span style={{ fontWeight: 600, color: c }}>{v}</span>
                    </div>
                ))}
                {/* Visual bar */}
                <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 4 }}>
                        <span>Demand</span><span>Capacity</span>
                    </div>
                    <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.min(100, (row.weeklyForecastDemand / Math.max(row.weeklyCapacity, row.weeklyForecastDemand)) * 100)}%`, background: C.amber, borderRadius: 6 }} />
                        <div style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: `${Math.min(100, (row.weeklyCapacity / Math.max(row.weeklyCapacity, row.weeklyForecastDemand)) * 100)}%`, background: `${C.blue}44`, borderRadius: 6 }} />
                    </div>
                </div>
            </div>

            {/* Day splits */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>📅 Delivery Day Breakdown</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                        { day: 'Monday', demand: row.mondayForecastDemand, cap: row.mondayCapacity, health: row.mondayHealth, gap: row.mondayGap },
                        { day: 'Thursday', demand: row.thursdayForecastDemand, cap: row.thursdayCapacity, health: row.thursdayHealth, gap: row.thursdayGap },
                    ].map((d, i) => {
                        const dhl = supplyHealthLabel(d.cap > 0 && d.demand > 0 ? (d.gap) / (d.demand * (1 + row.safetyMargin)) : 1);
                        return (
                            <div key={i} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 6 }}>{d.day}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                    <span style={{ color: C.muted }}>Demand</span><span style={{ color: C.fg, fontWeight: 600 }}>{d.demand}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                    <span style={{ color: C.muted }}>Capacity</span><span style={{ color: C.blue, fontWeight: 600 }}>{d.cap}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                                    <span style={{ color: C.muted }}>Gap</span><span style={{ color: d.gap >= 0 ? C.green : C.red, fontWeight: 700 }}>{d.gap >= 0 ? '+' : ''}{d.gap}</span>
                                </div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: dhl.color }}>{dhl.icon} {d.health}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Vendor breakdown */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>🏢 Vendor Capacity Breakdown</div>
                {row.vendorBreakdown.map((v, i) => (
                    <div key={i} style={{
                        padding: '10px 14px', marginBottom: 8, background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, color: C.fg, fontSize: 13 }}>{v.vendorName}</span>
                            <span style={{ fontWeight: 700, color: C.blue, fontSize: 13 }}>{v.weeklyCapacity} units</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
                            <span style={{ padding: '2px 6px', borderRadius: 4, background: `${C.blue}15`, color: C.blue }}>Mon: {v.mondayCapacity}</span>
                            <span style={{ padding: '2px 6px', borderRadius: 4, background: `${C.blue}15`, color: C.blue }}>Thu: {v.thursdayCapacity}</span>
                            <span style={{ padding: '2px 6px', borderRadius: 4, background: `${C.purple}15`, color: C.purple }}>Share: {Math.round(v.shareOfCapacity * 100)}%</span>
                            <span style={{ padding: '2px 6px', borderRadius: 4, background: `${C.muted}15`, color: C.muted }}>{v.capacityConfidence}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Alerts */}
            {row.alerts.length > 0 && (
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>🚨 Alerts</div>
                    {row.alerts.map((a, i) => {
                        const ac = a.severity === 'critical' ? C.red : a.severity === 'warning' ? C.amber : C.purple;
                        return (
                            <div key={i} style={{ fontSize: 12, color: ac, marginBottom: 6, padding: '6px 10px', background: `${ac}08`, borderRadius: 6 }}>
                                {a.text}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Actions */}
            <div style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>Admin Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {['Alert Vendors to Increase Capacity', 'Request Capacity Update', 'Watch This Item', 'Limit Suggested Order', 'Invite New Supplier', 'Review Substitutes'].map((a, i) => (
                        <button key={i} onClick={() => toast.info(`${a} — queued`)} style={{
                            width: '100%', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)',
                            color: C.blue, cursor: 'pointer', textAlign: 'left',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}><FiChevronRight size={14} /> {a}</button>
                    ))}
                </div>
            </div>
        </div>
    );
}
