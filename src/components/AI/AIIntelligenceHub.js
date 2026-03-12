/**
 * AIIntelligenceHub.js
 *
 * Unified AI Intelligence Layer for SuperAdmin.
 * 5 tabs: AI Summary, Price Intelligence, Risk Alerts, Seasonal Uplift, Dispatch Optimization.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { FiRefreshCw, FiDownload, FiSearch, FiChevronRight, FiX } from 'react-icons/fi';
import { computePriceIntelligence } from './priceIntelligenceEngine';
import { computeRiskAlerts } from './riskEngine';
import { computeSeasonalUplifts } from './seasonalUpliftEngine';
import { computeDispatchOptimization } from './dispatchOptimizationEngine';
import { generateWeeklySummary } from './aiSummaryEngine';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

// ── Design Tokens ────────────────────────────────────────────────────────────
const C = {
    bg: '#09090c', panel: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.07)',
    fg: '#f8fafc', muted: '#94a3b8', green: '#34d399', red: '#f87171', amber: '#fbbf24',
    blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', pink: '#ec4899',
};

const RISK_CFG = {
    HIGH:   { color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)', icon: '🚨' },
    MEDIUM: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.2)',  icon: '⚠️' },
    LOW:    { color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.15)', icon: '📋' },
};

const TABS = [
    { id: 'summary',   label: '🧠 AI Summary',           color: C.purple },
    { id: 'price',     label: '💰 Price Intelligence',    color: C.green  },
    { id: 'risk',      label: '⚠️ Risk Alerts',           color: C.red    },
    { id: 'seasonal',  label: '🎄 Seasonal Uplift',       color: C.amber  },
    { id: 'dispatch',  label: '🚚 Dispatch Optimization', color: C.blue   },
];

// ── Shared Styles ────────────────────────────────────────────────────────────
const thS = { padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
const tdS = { padding: '12px 14px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)' };

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function AIIntelligenceHub() {
    const [activeTab, setActiveTab] = useState('summary');
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [lastRefresh, setLastRefresh] = useState(null);

    // Module data
    const [priceData, setPriceData] = useState(null);
    const [riskData, setRiskData] = useState(null);
    const [seasonalData, setSeasonalData] = useState(null);
    const [dispatchData, setDispatchData] = useState(null);
    const [summaryData, setSummaryData] = useState(null);
    const [ordersStats, setOrdersStats] = useState(null);

    // ── Data Loading ─────────────────────────────────────────────────────
    const loadAll = async () => {
        setLoading(true);
        try {
            // Kick off all engines in parallel
            const [price, risk, seasonal, dispatch] = await Promise.all([
                computePriceIntelligence().catch(e => { console.error('[AI] Price engine error:', e); return null; }),
                computeRiskAlerts().catch(e => { console.error('[AI] Risk engine error:', e); return null; }),
                computeSeasonalUplifts().catch(e => { console.error('[AI] Seasonal engine error:', e); return null; }),
                computeDispatchOptimization().catch(e => { console.error('[AI] Dispatch engine error:', e); return null; }),
            ]);

            setPriceData(price);
            setRiskData(risk);
            setSeasonalData(seasonal);
            setDispatchData(dispatch);

            // Build order stats from dispatch data (already loaded submitted orders)
            let orders = { totalItems: 0, totalQty: 0, restaurantCount: 0, topItems: [] };
            if (dispatch?.suggestions?.length > 0) {
                const itemMap = {};
                dispatch.suggestions.forEach(g => {
                    g.items.forEach(i => {
                        itemMap[i.itemName] = (itemMap[i.itemName] || 0) + i.qty;
                    });
                });
                const topItems = Object.entries(itemMap).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
                orders = {
                    totalItems: topItems.length,
                    totalQty: topItems.reduce((s, i) => s + i.qty, 0),
                    restaurantCount: new Set(dispatch.suggestions.flatMap(g => [...(g.restaurants || [])])).size || '—',
                    topItems,
                };
            }
            setOrdersStats(orders);

            // Generate summary from all modules
            const summary = generateWeeklySummary({
                priceData: price,
                riskData: risk,
                seasonalData: seasonal,
                dispatchData: dispatch,
                ordersStats: orders,
            });
            setSummaryData(summary);

            setLastRefresh(new Date());
        } catch (err) {
            console.error('[AI] Failed to load intelligence data:', err);
        }
        setLoading(false);
    };

    useEffect(() => { loadAll(); }, []);

    // ── KPI Strip ────────────────────────────────────────────────────────
    const kpis = [
        { label: 'AI Insights', value: summaryData?.kpis?.totalInsights ?? '…', color: C.purple, icon: '🧠' },
        { label: 'Monthly Savings', value: summaryData ? `$${(summaryData.kpis.savingsOpportunity || 0).toFixed(0)}` : '…', color: C.green, icon: '💰' },
        { label: 'Risk Alerts', value: summaryData?.kpis?.riskAlerts ?? '…', color: C.red, icon: '⚠️' },
        { label: 'High Risks', value: summaryData?.kpis?.highRisks ?? '…', color: C.red, icon: '🚨' },
        { label: 'Seasonal Events', value: summaryData?.kpis?.seasonalEvents ?? '…', color: C.amber, icon: '🎄' },
        { label: 'Dispatch Groups', value: summaryData?.kpis?.dispatchGroups ?? '…', color: C.blue, icon: '🚚' },
    ];

    return (
        <div style={{ padding: '24px 32px', maxWidth: 1600, margin: '0 auto', minHeight: '100vh', color: C.fg, paddingBottom: 100 }}>

            {/* ── HEADER ──────────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, background: 'linear-gradient(135deg, #a78bfa, #38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        🤖 AI Intelligence Hub
                    </h1>
                    <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 14, maxWidth: 700 }}>
                        Marketplace intelligence layer — price analysis, supply risk detection, seasonal uplift, and dispatch optimization powered by live data.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {lastRefresh && <span style={{ fontSize: 11, color: C.muted }}>Last: {lastRefresh.toLocaleTimeString()}</span>}
                    <button onClick={loadAll} disabled={loading} style={{
                        padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                        background: C.panel, color: C.fg, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s',
                    }}>
                        <FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh All Modules
                    </button>
                </div>
            </div>

            {/* ── KPI STRIP ───────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 28 }}>
                {kpis.map(k => (
                    <div key={k.label} style={{
                        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
                        padding: '16px 18px', transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = `${k.color}44`}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                        <div style={{ fontSize: 18, marginBottom: 6 }}>{k.icon}</div>
                        <div style={{ fontSize: 26, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* ── TAB BAR ─────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
                {TABS.map(t => (
                    <button key={t.id} onClick={() => { setActiveTab(t.id); setSearch(''); }} style={{
                        padding: '10px 20px', borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                        background: activeTab === t.id ? `${t.color}18` : 'transparent',
                        color: activeTab === t.id ? t.color : C.muted,
                        borderBottom: activeTab === t.id ? `2px solid ${t.color}` : '2px solid transparent',
                    }}>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── LOADING ─────────────────────────────────────────── */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 80, color: C.muted, fontSize: 14 }}>
                    <FiRefreshCw size={24} className="spin" style={{ marginBottom: 12 }} /><br />
                    Running AI intelligence engines across all modules…
                </div>
            )}

            {/* ── TAB CONTENT ─────────────────────────────────────── */}
            {!loading && (
                <>
                    {activeTab === 'summary' && <SummaryTab data={summaryData} onNavigate={setActiveTab} />}
                    {activeTab === 'price' && <PriceTab data={priceData} search={search} setSearch={setSearch} />}
                    {activeTab === 'risk' && <RiskTab data={riskData} />}
                    {activeTab === 'seasonal' && <SeasonalTab data={seasonalData} />}
                    {activeTab === 'dispatch' && <DispatchTab data={dispatchData} />}
                </>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — AI SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
function SummaryTab({ data, onNavigate }) {
    if (!data) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>No summary available.</div>;

    return (
        <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.fg, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                🧠 AI Weekly Intelligence Summary
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 400, background: 'rgba(167,139,250,0.1)', padding: '2px 10px', borderRadius: 10 }}>
                    Generated {new Date(data.generatedAt).toLocaleTimeString()}
                </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.insights.map(insight => (
                    <div key={insight.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px',
                        background: `${insight.color}08`, border: `1px solid ${insight.color}20`, borderRadius: 12,
                        transition: 'transform 0.15s, border-color 0.15s', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = `${insight.color}44`; e.currentTarget.style.transform = 'translateX(4px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = `${insight.color}20`; e.currentTarget.style.transform = 'none'; }}
                    onClick={() => {
                        if (insight.id.includes('price') || insight.id.includes('savings') || insight.id.includes('cheapest')) onNavigate('price');
                        else if (insight.id.includes('risk')) onNavigate('risk');
                        else if (insight.id.includes('seasonal')) onNavigate('seasonal');
                        else if (insight.id.includes('dispatch')) onNavigate('dispatch');
                    }}>
                        <span style={{ fontSize: 22, flexShrink: 0 }}>{insight.icon}</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: insight.color, marginBottom: 3 }}>{insight.title}</div>
                            <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{insight.text}</div>
                        </div>
                        <FiChevronRight size={16} style={{ color: C.muted, flexShrink: 0, marginTop: 2 }} />
                    </div>
                ))}
            </div>
            {data.insights.length === 0 && (
                <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                    No intelligence insights available yet. Submit orders to generate analysis.
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — PRICE INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════
function PriceTab({ data, search, setSearch }) {
    const rows = useMemo(() => {
        if (!data) return [];
        let r = [...data.priceIntelligence];
        if (search) {
            const q = search.toLowerCase();
            r = r.filter(i => `${i.itemName} ${i.cheapestVendor} ${i.category}`.toLowerCase().includes(q));
        }
        return r;
    }, [data, search]);

    if (!data) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>No price data available.</div>;

    return (
        <div>
            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                {[
                    { label: 'Items Analyzed', value: data.summary.totalItems, color: C.blue },
                    { label: 'Items with Alerts', value: data.summary.itemsWithAlerts, color: C.red },
                    { label: 'Monthly Savings', value: `$${data.summary.totalMonthlySavings.toFixed(2)}`, color: C.green },
                    { label: 'Avg Price Spread', value: `$${data.summary.avgSpread.toFixed(2)}`, color: C.amber },
                ].map(k => (
                    <div key={k.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Price Alerts Banner */}
            {data.priceAlerts.length > 0 && (
                <div style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 10, padding: '12px 18px', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 6 }}>🔔 Price Alerts — {data.priceAlerts.length} item{data.priceAlerts.length > 1 ? 's' : ''} with vendor prices {'>'} 10% above average</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {data.priceAlerts.slice(0, 5).map((a, i) => (
                            <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, background: 'rgba(248,113,113,0.12)', color: C.red }}>
                                {a.itemName} — {a.alerts[0]?.vendorName} (+{a.alerts[0]?.percentAbove}%)
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Search */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
                    <FiSearch size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                    <input placeholder="Search item or vendor…" value={search} onChange={e => setSearch(e.target.value)} style={{
                        padding: '8px 12px 8px 32px', borderRadius: 8, border: `1px solid ${C.border}`,
                        background: C.panel, color: C.fg, fontSize: 13, width: '100%', outline: 'none',
                    }} />
                </div>
                <span style={{ fontSize: 12, color: C.muted }}>{rows.length} items</span>
            </div>

            {/* Table */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            {['Item', 'Category', 'Vendors', 'Cheapest', 'Cheapest Price', 'Avg Price', 'Spread', 'Savings/Unit', 'Monthly Savings', 'Alert'].map(h => (
                                <th key={h} style={thS}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, idx) => (
                            <tr key={idx} style={{ transition: 'background 0.1s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.itemName}</td>
                                <td style={tdS}><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: r.category === 'Produce' ? 'rgba(52,211,153,0.1)' : r.category === 'Packaging' ? 'rgba(56,189,248,0.1)' : 'rgba(251,191,36,0.1)', color: r.category === 'Produce' ? C.green : r.category === 'Packaging' ? C.blue : C.amber }}>{r.category}</span></td>
                                <td style={{ ...tdS, color: C.muted }}>{r.vendorCount}</td>
                                <td style={{ ...tdS, color: C.green, fontWeight: 600 }}>{r.cheapestVendor}</td>
                                <td style={{ ...tdS, color: C.green, fontWeight: 700 }}>${r.cheapestPrice.toFixed(2)}</td>
                                <td style={{ ...tdS, color: C.fg }}>${r.avgPrice.toFixed(2)}</td>
                                <td style={{ ...tdS, color: r.spread > 2 ? C.red : C.muted, fontWeight: r.spread > 2 ? 700 : 400 }}>${r.spread.toFixed(2)}</td>
                                <td style={{ ...tdS, color: r.savingsPerUnit > 0 ? C.green : C.muted }}>${r.savingsPerUnit.toFixed(2)}</td>
                                <td style={{ ...tdS, color: r.estimatedMonthlySavings > 0 ? C.green : C.muted, fontWeight: r.estimatedMonthlySavings > 10 ? 700 : 400 }}>${r.estimatedMonthlySavings.toFixed(2)}</td>
                                <td style={tdS}>
                                    {r.hasAlert && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(248,113,113,0.15)', color: C.red }}>⚠ Alert</span>}
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>No items match search</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — RISK ALERTS
// ══════════════════════════════════════════════════════════════════════════════
function RiskTab({ data }) {
    if (!data) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>No risk data available.</div>;

    return (
        <div>
            {/* Summary Badges */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
                {[
                    { label: 'Total Alerts', value: data.summary.total, color: C.blue },
                    { label: 'HIGH', value: data.summary.high, color: '#f87171' },
                    { label: 'MEDIUM', value: data.summary.medium, color: '#fbbf24' },
                    { label: 'LOW', value: data.summary.low, color: '#94a3b8' },
                ].map(k => (
                    <div key={k.label} style={{ background: `${k.color}0a`, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '14px 20px', minWidth: 100 }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Alert Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.alerts.map((alert, i) => {
                    const cfg = RISK_CFG[alert.risk] || RISK_CFG.LOW;
                    return (
                        <div key={alert.id || i} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px',
                            background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12,
                            borderLeft: `4px solid ${cfg.color}`,
                        }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{alert.icon || cfg.icon}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: `${cfg.color}22`, color: cfg.color, letterSpacing: 0.5 }}>{alert.risk}</span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{alert.type}</span>
                                </div>
                                <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{alert.detail}</div>
                                {alert.reliabilityScore !== undefined && (
                                    <div style={{ marginTop: 6 }}>
                                        <div style={{ width: 120, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' }}>
                                            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${alert.reliabilityScore}%`, background: alert.reliabilityScore >= 80 ? C.green : alert.reliabilityScore >= 60 ? C.amber : C.red, borderRadius: 3 }} />
                                        </div>
                                        <span style={{ fontSize: 10, color: C.muted }}>Reliability: {alert.reliabilityScore}/100</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {data.alerts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                        ✅ No supply chain risks detected — marketplace health is strong.
                    </div>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — SEASONAL UPLIFT
// ══════════════════════════════════════════════════════════════════════════════
function SeasonalTab({ data }) {
    if (!data) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>No seasonal data available.</div>;

    return (
        <div>
            {/* Summary */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
                {[
                    { label: 'Upcoming Events', value: data.summary.totalEvents, color: C.amber },
                    { label: 'Active Now', value: data.summary.activeNow, color: C.green },
                    { label: 'This Week', value: data.summary.thisWeek, color: C.blue },
                    { label: 'Uplift Rules', value: data.summary.totalRules, color: C.purple },
                ].map(k => (
                    <div key={k.label} style={{ background: `${k.color}0a`, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '14px 20px', minWidth: 100 }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Event Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.uplifts.map(evt => (
                    <div key={evt.id} style={{
                        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 22px',
                        borderLeft: `4px solid ${evt.statusColor}`,
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                            <div>
                                <div style={{ fontSize: 16, fontWeight: 700, color: C.fg }}>🎉 {evt.eventName}</div>
                                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{evt.startDate} → {evt.endDate}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: `${evt.statusColor}22`, color: evt.statusColor }}>
                                    {evt.status}
                                </span>
                                {!evt.isActive && <span style={{ fontSize: 11, color: C.muted }}>{evt.daysUntil} days away</span>}
                            </div>
                        </div>

                        {/* Uplift Rules */}
                        {evt.rules.length > 0 ? (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: evt.notes ? 10 : 0 }}>
                                {evt.rules.map((r, i) => (
                                    <div key={i} style={{
                                        fontSize: 12, padding: '5px 12px', borderRadius: 8,
                                        background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)',
                                    }}>
                                        <strong style={{ color: C.purple }}>{r.category}</strong>
                                        <span style={{ color: C.green, marginLeft: 6, fontWeight: 700 }}>+{r.upliftPercent}%</span>
                                        <span style={{ color: C.muted, marginLeft: 4 }}>(×{r.upliftFactor.toFixed(2)})</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No uplift rules configured — edit in Festival Calendar</div>
                        )}

                        {evt.notes && <div style={{ fontSize: 12, color: C.muted, marginTop: 6, fontStyle: 'italic' }}>📝 {evt.notes}</div>}
                    </div>
                ))}
                {data.uplifts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                        No upcoming seasonal events in the next 60 days. Add events in the Festival & Seasonality Calendar.
                    </div>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — DISPATCH OPTIMIZATION
// ══════════════════════════════════════════════════════════════════════════════
function DispatchTab({ data }) {
    if (!data) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>No dispatch data available.</div>;

    return (
        <div>
            {/* Summary */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
                {[
                    { label: 'Consolidation Groups', value: data.summary.totalGroups, color: C.blue },
                    { label: 'Total Items', value: data.summary.totalItems, color: C.fg },
                    { label: 'Total Value', value: `$${data.summary.totalValue.toFixed(2)}`, color: C.green },
                    { label: 'High Efficiency', value: data.summary.highEfficiency, color: C.green },
                    { label: 'Unique Vendors', value: data.summary.uniqueVendors, color: C.purple },
                ].map(k => (
                    <div key={k.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px', flex: 1 }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{k.label}</div>
                    </div>
                ))}
            </div>

            {/* Consolidation Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.suggestions.map(g => (
                    <div key={g.id} style={{
                        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 22px',
                        borderLeft: `4px solid ${g.efficiencyColor}`,
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>🚚 {g.vendor}</div>
                                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                                    {g.day} Delivery • {g.itemCount} items • ${g.totalValue.toFixed(2)} total
                                </div>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: `${g.efficiencyColor}22`, color: g.efficiencyColor }}>
                                {g.efficiency} Efficiency
                            </span>
                        </div>

                        {/* Item List */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                            {g.items.map((item, i) => (
                                <span key={i} style={{
                                    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                                    background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.15)', color: C.blue,
                                }}>
                                    {item.itemName} <span style={{ color: C.muted }}>×{item.qty}</span>
                                </span>
                            ))}
                        </div>

                        <div style={{ fontSize: 12, color: C.muted }}>
                            💡 <em>{g.reason}</em>
                        </div>
                    </div>
                ))}
                {data.suggestions.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                        No dispatch consolidation opportunities this week. All dispatches are already optimized.
                    </div>
                )}
            </div>
        </div>
    );
}
