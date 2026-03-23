/**
 * PriceIntelligenceSection.jsx
 * 
 * Executive procurement intelligence panel for the Control Tower overview tab.
 * Reuses computePriceIntelligence() from priceIntelligenceEngine.js.
 *
 * Shows:  KPI cards · Top Savings Opportunities · Vendor Ranking · Items Needing Review
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { computePriceIntelligence } from '../AI/priceIntelligenceEngine';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { FiRefreshCw } from 'react-icons/fi';

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n, d = 2) => (n == null || isNaN(n)) ? '—' : `$${Number(n).toFixed(d)}`;
const pct = (n) => (n == null || isNaN(n)) ? '—' : `${Number(n).toFixed(1)}%`;

const CARD_STYLE = {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '16px 18px',
    transition: 'all 0.2s',
    cursor: 'default',
};

const TABLE_HEADER = {
    padding: '10px 8px',
    fontWeight: 600,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: '#94a3b8',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    textAlign: 'left',
};

const TABLE_CELL = {
    padding: '10px 8px',
    fontSize: 13,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const CONFIDENCE_COLORS = {
    High:   { bg: 'rgba(52,211,153,0.12)', color: '#34d399', border: 'rgba(52,211,153,0.25)' },
    Medium: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: 'rgba(251,191,36,0.25)' },
    Low:    { bg: 'rgba(248,113,113,0.12)', color: '#f87171', border: 'rgba(248,113,113,0.25)' },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function PriceIntelligenceSection() {
    const [data, setData] = useState(null);
    const [reviewItems, setReviewItems] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showAllSavings, setShowAllSavings] = useState(false);
    const [showAllVendors, setShowAllVendors] = useState(false);
    const [showReviewDrawer, setShowReviewDrawer] = useState(false);
    const [excludedItemsList, setExcludedItemsList] = useState([]);
    const loadedRef = useRef(false);
    const navigate = useNavigate();

    useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;

        const load = async () => {
            setLoading(true);
            try {
                // 1. Price intelligence from existing engine
                const result = await computePriceIntelligence();

                // 2. Count items needing review (raw-only, unmapped, pending, rejected)
                const vendorsSnap = await getDocs(collection(db, 'vendors'));
                const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                let rawOnly = 0, unmapped = 0, pendingReview = 0, rejected = 0, invalidPrice = 0;
                const excludedList = [];

                for (const v of vendors) {
                    try {
                        const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
                        itemSnap.docs.forEach(d => {
                            const item = d.data();
                            const itemId = d.id;
                            const status = (item.normalizedStatus || item.status || '').toLowerCase();
                            const price = parseFloat(item.vendorPrice) || parseFloat(item.price) || 0;
                            const unit = (item.unit || item.baseUnit || '').toLowerCase();
                            const opaqueUnits = ['bundle', 'bag', 'case', 'box', 'tray', 'pack'];
                            const itemName = item.itemName || item.name || '(unnamed)';
                            const vendorName = v.name || 'Unknown Vendor';
                            const base = { itemId, vendorId: v.id, vendorName, itemName, price, unit, status: item.normalizedStatus || item.status || '' };

                            if (['rejected'].includes(status)) { rejected++; excludedList.push({ ...base, reason: 'Rejected' }); return; }
                            if (['in-review', 'in review', 'pending', 'review_flagged', 'pending_review'].includes(status)) { pendingReview++; excludedList.push({ ...base, reason: 'Pending Review' }); return; }
                            if (!item.catalogItemId) { unmapped++; excludedList.push({ ...base, reason: 'Unmapped' }); return; }
                            if (price <= 0) { invalidPrice++; excludedList.push({ ...base, reason: 'Invalid Price' }); return; }
                            if (opaqueUnits.includes(unit) && !(Number(item.packQuantity) > 1)) { rawOnly++; excludedList.push({ ...base, reason: 'Raw Only' }); return; }
                        });
                    } catch (e) { /* skip */ }
                }

                setExcludedItemsList(excludedList);
                setReviewItems({ rawOnly, unmapped, pendingReview, rejected, invalidPrice, total: rawOnly + unmapped + pendingReview + rejected + invalidPrice });
                setData(result);
            } catch (err) {
                console.error('[PriceIntelligence] Load failed:', err);
            } finally {
                setLoading(false);
            }
        };

        load();
    }, []);

    if (loading) {
        return (
            <div style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.1)', borderRadius: 12, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#94a3b8', marginBottom: 24 }}>
                <FiRefreshCw className="spin" size={14} /> Loading Price Intelligence...
            </div>
        );
    }

    if (!data) return null;

    const { priceIntelligence, summary } = data;

    // ── Derived KPI values ──
    const comparableItems = priceIntelligence.filter(r => r.vendorCount >= 2);
    const vendorsComparedSet = new Set();
    comparableItems.forEach(r => r.vendors.forEach(v => vendorsComparedSet.add(v.vendorId)));

    const totalMonthlySavings = comparableItems.reduce((s, r) => s + (r.estimatedMonthlySavings || 0), 0);
    const bestSaving = comparableItems.length > 0 ? comparableItems[0] : null;
    const avgSpread = comparableItems.length > 0
        ? comparableItems.reduce((s, r) => s + (r.cheapestPrice > 0 ? ((r.highestPrice - r.cheapestPrice) / r.cheapestPrice) * 100 : 0), 0) / comparableItems.length
        : 0;

    // ── Vendor ranking ──
    const vendorWins = {};
    const vendorVariance = {};
    const vendorItemCount = {};

    comparableItems.forEach(r => {
        const cheapest = r.cheapestVendor;
        r.vendors.forEach(v => {
            if (!vendorWins[v.vendorName]) vendorWins[v.vendorName] = 0;
            if (!vendorVariance[v.vendorName]) vendorVariance[v.vendorName] = { sum: 0, count: 0 };
            if (!vendorItemCount[v.vendorName]) vendorItemCount[v.vendorName] = 0;

            vendorItemCount[v.vendorName]++;
            if (v.vendorName === cheapest) vendorWins[v.vendorName]++;
            if (r.cheapestPrice > 0) {
                const variance = ((v.price - r.cheapestPrice) / r.cheapestPrice) * 100;
                vendorVariance[v.vendorName].sum += variance;
                vendorVariance[v.vendorName].count++;
            }
        });
    });

    const vendorRanking = Object.keys(vendorWins).map(name => {
        const wins = vendorWins[name];
        const items = vendorItemCount[name] || 0;
        const avgVar = vendorVariance[name]?.count > 0 ? vendorVariance[name].sum / vendorVariance[name].count : 0;
        // Score: higher wins + lower variance = better. Weighted formula.
        const score = items > 0 ? Math.round((wins / items) * 100 - avgVar * 0.5) : 0;
        return { name, wins, items, avgVariance: avgVar, score };
    }).sort((a, b) => b.score - a.score);

    // ── Confidence helper ──
    const getConfidence = (r) => {
        if (r.monthlyDemand > 0 && r.vendorCount >= 3) return 'High';
        if (r.monthlyDemand > 0 || r.vendorCount >= 2) return 'Medium';
        return 'Low';
    };

    const savingsRows = showAllSavings ? comparableItems : comparableItems.slice(0, 10);
    const vendorRows = showAllVendors ? vendorRanking : vendorRanking.slice(0, 5);

    // ── KPI card definitions ──
    const kpis = [
        { label: 'Comparable Items', value: comparableItems.length, icon: '📊', color: '#38bdf8' },
        { label: 'Vendors Compared', value: vendorsComparedSet.size, icon: '🏢', color: '#a78bfa' },
        { label: 'Monthly Savings Potential', value: fmt(totalMonthlySavings), icon: '💰', color: '#10b981' },
        { label: 'Best Opportunity', value: bestSaving ? fmt(bestSaving.estimatedMonthlySavings) + '/mo' : '—', icon: '🏆', color: '#fbbf24', sub: bestSaving?.itemName },
        { label: 'Avg Market Spread', value: pct(avgSpread), icon: '📈', color: '#ec4899' },
        { label: 'Items Excluded from Comparison', value: reviewItems?.total || 0, icon: '⚠️', color: (reviewItems?.total || 0) > 0 ? '#f43f5e' : '#94a3b8', onClick: () => setShowReviewDrawer(true) },
    ];

    return (
        <div style={{ marginBottom: 28 }}>
            {/* Section Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ background: 'linear-gradient(135deg, #10b981, #38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>💎 Price Intelligence</span>
                    <span style={{ fontSize: 10, color: '#64748b', fontWeight: 400, background: 'rgba(16,185,129,0.08)', padding: '3px 10px', borderRadius: 6 }}>Procurement Insights</span>
                </h3>
            </div>

            {/* Empty-state explanation banner — shown when no items are comparable yet */}
            {comparableItems.length === 0 && (
                <div style={{ background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 10, padding: '14px 18px', marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 20 }}>💡</span>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>Not enough comparable mapped vendor pricing yet.</div>
                        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                            Price comparison requires at least <strong style={{ color: '#94a3b8' }}>2 mapped vendors offering the same catalog item</strong> with valid prices.{' '}
                            Currently <strong style={{ color: '#f59e0b' }}>{reviewItems?.unmapped || 0} items are unmapped</strong> and{' '}
                            <strong style={{ color: '#f43f5e' }}>{(reviewItems?.pendingReview || 0) + (reviewItems?.invalidPrice || 0)} items have missing or invalid prices</strong>.{' '}
                            Resolve these in the Review Queue to unlock comparisons.
                        </div>
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 22 }}>
                {kpis.map((kpi, i) => {
                    const handleClick = kpi.onClick ? (e) => { e.stopPropagation(); kpi.onClick(); } : undefined;
                    return (
                        <div key={i} data-testid={`price-intel-kpi-${i}`}
                            onClick={handleClick}
                            role={kpi.onClick ? 'button' : undefined}
                            tabIndex={kpi.onClick ? 0 : undefined}
                            style={{ ...CARD_STYLE, borderColor: `${kpi.color}18`, cursor: kpi.onClick ? 'pointer' : 'default', pointerEvents: 'auto', position: 'relative', zIndex: 1 }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = `${kpi.color}44`; e.currentTarget.style.background = `${kpi.color}08`; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = `${kpi.color}18`; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}>
                            <div style={{ pointerEvents: 'none', fontSize: 18, marginBottom: 6 }}>{kpi.icon}</div>
                            <div style={{ pointerEvents: 'none', fontSize: 20, fontWeight: 700, color: kpi.color, marginBottom: 2 }}>{kpi.value}</div>
                            <div style={{ pointerEvents: 'none', fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{kpi.label}</div>
                            {kpi.sub && <div style={{ pointerEvents: 'none', fontSize: 10, color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>{kpi.sub}</div>}
                        </div>
                    );
                })}
            </div>

            {/* Two-column layout: Savings Table + Vendor Ranking */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 18 }}>

                {/* TOP SAVINGS OPPORTUNITIES */}
                <div style={{ ...CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 18px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>🎯 Top Savings Opportunities</h4>
                        <span style={{ fontSize: 10, color: '#64748b' }}>{comparableItems.length} comparable items</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    {['Item', 'Cheapest', 'Price', 'Benchmark', 'Spread %', 'Mo. Est.', 'Mo. Savings', 'Conf.'].map(h => (
                                        <th key={h} style={TABLE_HEADER}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {savingsRows.map((r, i) => {
                                    const spreadPct = r.cheapestPrice > 0 ? ((r.highestPrice - r.cheapestPrice) / r.cheapestPrice) * 100 : 0;
                                    const conf = getConfidence(r);
                                    const cc = CONFIDENCE_COLORS[conf];
                                    const benchmark = r.vendors.length > 1 ? r.vendors[r.vendors.length - 1] : null;
                                    return (
                                        <tr key={i}
                                            style={{ transition: 'background 0.15s' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.04)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ ...TABLE_CELL, fontWeight: 600, color: '#e2e8f0', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.itemName}</td>
                                            <td style={{ ...TABLE_CELL, color: '#a78bfa', fontSize: 12 }}>{r.cheapestVendor}</td>
                                            <td style={{ ...TABLE_CELL, color: '#10b981', fontWeight: 700 }}>{fmt(r.cheapestPrice)}</td>
                                            <td style={{ ...TABLE_CELL, color: '#f87171', fontSize: 12 }}>{benchmark ? `${benchmark.vendorName} ${fmt(benchmark.price)}` : '—'}</td>
                                            <td style={{ ...TABLE_CELL, color: spreadPct > 20 ? '#f87171' : spreadPct > 10 ? '#fbbf24' : '#94a3b8', fontWeight: 600 }}>{pct(spreadPct)}</td>
                                            <td style={{ ...TABLE_CELL, color: '#94a3b8' }}>{r.monthlyDemand > 0 ? r.monthlyDemand : '—'}</td>
                                            <td style={{ ...TABLE_CELL, color: r.estimatedMonthlySavings > 0 ? '#10b981' : '#94a3b8', fontWeight: 700 }}>{r.estimatedMonthlySavings > 0 ? fmt(r.estimatedMonthlySavings) : '—'}</td>
                                            <td style={TABLE_CELL}>
                                                <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: cc.bg, color: cc.color, border: `1px solid ${cc.border}` }}>{conf}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {savingsRows.length === 0 && (
                                    <tr><td colSpan={8} style={{ ...TABLE_CELL, textAlign: 'center', color: '#64748b', padding: 28 }}>
                                        <div style={{ marginBottom: 8, fontSize: 20 }}>🔗</div>
                                        <div style={{ fontWeight: 600, color: '#475569', marginBottom: 4 }}>No comparable items yet</div>
                                        <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.6 }}>
                                            At least 2 mapped vendors must offer the same catalog item with valid prices for comparison to appear.
                                        </div>
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {comparableItems.length > 10 && (
                        <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.05)', textAlign: 'center' }}>
                            <button onClick={() => setShowAllSavings(!showAllSavings)}
                                style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                                {showAllSavings ? 'Show Top 10 ▲' : `View All ${comparableItems.length} ▼`}
                            </button>
                        </div>
                    )}
                </div>

                {/* VENDOR RANKING SNAPSHOT */}
                <div style={{ ...CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 18px 10px' }}>
                        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>🏅 Vendor Ranking</h4>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                {['#', 'Vendor', 'Wins', 'Avg Var.', 'Items', 'Score'].map(h => (
                                    <th key={h} style={{ ...TABLE_HEADER, padding: '8px 6px', fontSize: 9 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {vendorRows.map((v, i) => (
                                <tr key={v.name}
                                    style={{ transition: 'background 0.15s' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(167,139,250,0.04)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                    <td style={{ ...TABLE_CELL, fontWeight: 700, color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7f32' : '#64748b', fontSize: 14, padding: '8px 6px' }}>
                                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                                    </td>
                                    <td style={{ ...TABLE_CELL, fontWeight: 600, color: '#e2e8f0', fontSize: 12, padding: '8px 6px' }}>{v.name}</td>
                                    <td style={{ ...TABLE_CELL, color: '#10b981', fontWeight: 700, fontSize: 13, padding: '8px 6px' }}>{v.wins}</td>
                                    <td style={{ ...TABLE_CELL, color: v.avgVariance > 10 ? '#f87171' : v.avgVariance > 5 ? '#fbbf24' : '#94a3b8', fontSize: 12, padding: '8px 6px' }}>
                                        {v.avgVariance > 0 ? `+${v.avgVariance.toFixed(1)}%` : '0%'}
                                    </td>
                                    <td style={{ ...TABLE_CELL, color: '#94a3b8', fontSize: 12, padding: '8px 6px' }}>{v.items}</td>
                                    <td style={{ ...TABLE_CELL, padding: '8px 6px' }}>
                                        <span style={{
                                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                            background: v.score >= 60 ? 'rgba(52,211,153,0.12)' : v.score >= 30 ? 'rgba(251,191,36,0.12)' : 'rgba(248,113,113,0.12)',
                                            color: v.score >= 60 ? '#34d399' : v.score >= 30 ? '#fbbf24' : '#f87171',
                                        }}>{v.score}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {vendorRanking.length > 5 && (
                        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', textAlign: 'center' }}>
                            <button onClick={() => setShowAllVendors(!showAllVendors)}
                                style={{ background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                                {showAllVendors ? 'Top 5 ▲' : `All ${vendorRanking.length} ▼`}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ITEMS NEEDING REVIEW SUMMARY */}
            {reviewItems && reviewItems.total > 0 && (
                <div style={{ ...CARD_STYLE, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        ⚠️ Items Excluded from Comparison
                    </div>
                    <button onClick={() => setShowReviewDrawer(true)} style={{ background: 'transparent', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6 }}>
                        View Details →
                    </button>
                    {[
                        { label: 'Raw Only', count: reviewItems.rawOnly, color: '#94a3b8' },
                        { label: 'Unmapped', count: reviewItems.unmapped, color: '#f59e0b' },
                        { label: 'Pending Review', count: reviewItems.pendingReview, color: '#fbbf24' },
                        { label: 'Rejected', count: reviewItems.rejected, color: '#f43f5e' },
                        { label: 'Invalid Price', count: reviewItems.invalidPrice, color: '#f87171' },
                    ].filter(r => r.count > 0).map(r => (
                        <button key={r.label} onClick={() => setShowReviewDrawer(true)}
                            style={{
                                fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6,
                                background: `${r.color}12`, color: r.color, border: `1px solid ${r.color}30`,
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = `${r.color}25`; e.currentTarget.style.transform = 'scale(1.05)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = `${r.color}12`; e.currentTarget.style.transform = 'scale(1)'; }}>
                            {r.label}: {r.count}
                        </button>
                    ))}
                </div>
            )}

            {/* ── REVIEW ITEMS DRAWER MODAL ── */}
            {showReviewDrawer && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 }}
                    onClick={() => setShowReviewDrawer(false)}>
                    <div style={{ width: '65%', maxWidth: 900, height: '100%', background: '#0f1117', borderLeft: '1px solid rgba(255,255,255,0.1)', overflowY: 'auto', padding: '28px 32px' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
                            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>⚠️ Items Excluded from Price Comparison</h2>
                            <button onClick={() => setShowReviewDrawer(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 22 }}>&times;</button>
                        </div>

                        {/* Summary chips */}
                        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                            {[
                                { label: 'Raw Only', count: reviewItems?.rawOnly, color: '#94a3b8' },
                                { label: 'Unmapped', count: reviewItems?.unmapped, color: '#f59e0b' },
                                { label: 'Pending Review', count: reviewItems?.pendingReview, color: '#fbbf24' },
                                { label: 'Rejected', count: reviewItems?.rejected, color: '#f43f5e' },
                                { label: 'Invalid Price', count: reviewItems?.invalidPrice, color: '#f87171' },
                            ].filter(r => r.count > 0).map(r => (
                                <span key={r.label} style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6, background: `${r.color}15`, color: r.color, border: `1px solid ${r.color}30` }}>
                                    {r.label}: {r.count}
                                </span>
                            ))}
                        </div>

                        {/* Reason legend */}
                        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 12, lineHeight: 1.8 }}>
                            <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: 6, fontSize: 13 }}>Why are these excluded?</div>
                            {reviewItems?.rawOnly > 0 && (
                                <div><span style={{ color: '#94a3b8', fontWeight: 600 }}>Raw Only</span> — Unit is "case", "bag", "bundle", etc. but <strong style={{ color: '#f8fafc' }}>no pack size is set</strong>. Without knowing how many lbs/units are in a case, we can't calculate a per-lb price to compare across vendors. <strong style={{ color: '#38bdf8' }}>Fix:</strong> Edit the item → set Pack Quantity (e.g. case = 40 lb).</div>
                            )}
                            {reviewItems?.unmapped > 0 && (
                                <div><span style={{ color: '#f59e0b', fontWeight: 600 }}>Unmapped</span> — Item is not linked to a master catalog item (no <code style={{ color: '#a78bfa', fontSize: 11 }}>catalogItemId</code>). <strong style={{ color: '#38bdf8' }}>Fix:</strong> Map the item via Mapping Review or Catalog Review Queue.</div>
                            )}
                            {reviewItems?.pendingReview > 0 && (
                                <div><span style={{ color: '#fbbf24', fontWeight: 600 }}>Pending Review</span> — Item has been flagged for review and is waiting for approval. <strong style={{ color: '#38bdf8' }}>Fix:</strong> Approve or reject in the Catalog Review Queue.</div>
                            )}
                            {reviewItems?.rejected > 0 && (
                                <div><span style={{ color: '#f43f5e', fontWeight: 600 }}>Rejected</span> — Item was reviewed and rejected. <strong style={{ color: '#38bdf8' }}>Fix:</strong> Re-submit with corrected data or remove.</div>
                            )}
                            {reviewItems?.invalidPrice > 0 && (
                                <div><span style={{ color: '#f87171', fontWeight: 600 }}>Invalid Price</span> — Price is $0 or missing. <strong style={{ color: '#38bdf8' }}>Fix:</strong> Edit the item and set a valid vendor price.</div>
                            )}
                        </div>

                        {/* Items table */}
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                    {['Item Name', 'Vendor', 'Price', 'Unit', 'Issue', 'How to Fix', ''].map(h => (
                                        <th key={h} style={{ padding: '10px 8px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: '#94a3b8', textAlign: 'left' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {excludedItemsList.map((item, i) => {
                                    const reasonColors = { 'Raw Only': '#94a3b8', 'Unmapped': '#f59e0b', 'Pending Review': '#fbbf24', 'Rejected': '#f43f5e', 'Invalid Price': '#f87171' };
                                    const rc = reasonColors[item.reason] || '#94a3b8';
                                    const fixText = {
                                        'Raw Only': 'Set pack size (e.g. case = 40 lb)',
                                        'Unmapped': 'Map to catalog item',
                                        'Pending Review': 'Approve or reject',
                                        'Rejected': 'Re-submit or remove',
                                        'Invalid Price': 'Set valid vendor price',
                                    };
                                    const goToVendor = () => { setShowReviewDrawer(false); navigate(`/vendors/${item.vendorId}`); };
                                    return (
                                        <tr key={i}
                                            onClick={goToVendor}
                                            style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s', cursor: 'pointer' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.04)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '10px 8px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{item.itemName}</td>
                                            <td style={{ padding: '10px 8px', fontSize: 12, color: '#a78bfa' }}>{item.vendorName}</td>
                                            <td style={{ padding: '10px 8px', fontSize: 13, color: item.price > 0 ? '#10b981' : '#f87171', fontWeight: 600 }}>{item.price > 0 ? `$${item.price.toFixed(2)}` : '—'}</td>
                                            <td style={{ padding: '10px 8px', fontSize: 12, color: '#94a3b8' }}>{item.unit || '—'}</td>
                                            <td style={{ padding: '10px 8px' }}>
                                                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${rc}15`, color: rc, border: `1px solid ${rc}30` }}>{item.reason}</span>
                                            </td>
                                            <td style={{ padding: '10px 8px', fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>{fixText[item.reason] || '—'}</td>
                                            <td style={{ padding: '10px 8px', fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>View →</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {excludedItemsList.length === 0 && (
                            <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>No excluded items found.</div>
                        )}

                        <div style={{ marginTop: 20, padding: '14px 0', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: '#64748b' }}>
                            Once fixed, items will automatically appear in the Price Intelligence comparison on next refresh.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
