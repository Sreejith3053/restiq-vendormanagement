/**
 * VendorCompetitivenessDashboard.js
 *
 * Admin-facing full Vendor Competitiveness Score dashboard.
 * KPI strip, ranking table, detail drawer with factor breakdown,
 * marketplace health alerts, and price position analysis.
 */
import React, { useState, useMemo } from 'react';
import {
    FiRefreshCw, FiDownload, FiSearch, FiX, FiChevronRight,
    FiTrendingUp, FiTrendingDown, FiAlertTriangle, FiCheckCircle,
    FiAward, FiEye, FiShield, FiActivity, FiDollarSign,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import {
    generateMockScores, scoreLabel, getImprovementSuggestions, DEFAULT_WEIGHTS,
} from '../Vendors/vendorCompetitivenessEngine';

// ── Data ──────────────────────────────────────────────────────────────────────
const ALL_SCORES = generateMockScores();
const CATEGORIES = ['All', 'Produce', 'Packaging', 'Meat', 'Dairy'];
const SORT_OPTIONS = [
    { key: 'score', label: 'Score' },
    { key: 'price', label: 'Price' },
    { key: 'reliability', label: 'Reliability' },
    { key: 'category', label: 'Category' },
];

// Mock score trend (weekly history)
const MOCK_TRENDS = {};
ALL_SCORES.forEach(s => {
    const key = `${s.vendorId}_${s.itemName}`;
    const base = s.finalScore;
    MOCK_TRENDS[key] = [
        { week: 'W1', score: Math.max(0, base - Math.floor(Math.random() * 12) - 5) },
        { week: 'W2', score: Math.max(0, base - Math.floor(Math.random() * 8) - 2) },
        { week: 'W3', score: Math.max(0, base - Math.floor(Math.random() * 4)) },
        { week: 'W4', score: base },
    ];
});

// Mock health alerts
const HEALTH_ALERTS = [
    { type: 'risk', icon: '⚠️', text: 'Vendor Risk: Test Taas reliability dropped to 62% — score now At Risk for 2 comparable groups', color: '#f87171' },
    { type: 'volatility', icon: '📉', text: 'Price Volatility: Chicken Breast 10lb — price rose 7.3% in 4 weeks. 2 vendors may become uncompetitive.', color: '#fbbf24' },
    { type: 'opportunity', icon: '🟢', text: 'New Entry: ON Thyme entered coriander_fresh_1lb at lowest price — may shift market ranking', color: '#34d399' },
    { type: 'bundle', icon: '🔗', text: 'Bundle Gap: Vendor A is missing 8oz Soup Cup Lids — losing 5 bundle score points', color: '#a78bfa' },
];

// ── Tokens ─────────────────────────────────────────────────────────────────────
const C = { green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8', purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc' };
const badgeColor = { 'Best Overall Choice': C.green, 'Lowest Price': C.blue, 'Most Reliable': C.purple };

// ── Helpers ───────────────────────────────────────────────────────────────────
function pricePosition(record) {
    const sameCat = ALL_SCORES.filter(s => s.comparableGroup === record.comparableGroup);
    const sorted = [...sameCat].sort((a, b) => a.normalizedPrice - b.normalizedPrice);
    const idx = sorted.findIndex(s => s.vendorId === record.vendorId);
    if (idx === 0) return '1st (Lowest)';
    if (idx === 1) return '2nd Lowest';
    if (idx === sorted.length - 1) return `${sorted.length}th (Highest)`;
    return `${idx + 1}${idx === 2 ? 'rd' : 'th'}`;
}

function reliabilityPct(record) { return `${Math.round(record.reliabilityScore * 100)}%`; }
function bundleStatus(record) { return record.bundleScore >= 1 ? 'Complete' : record.bundleScore >= 0.5 ? 'Partial' : 'Missing'; }
function responseSpeed(record) { return record.responseScore >= 0.85 ? 'Fast' : record.responseScore >= 0.6 ? 'Average' : 'Slow'; }

function vendorRank(record) {
    const sameCat = ALL_SCORES.filter(s => s.comparableGroup === record.comparableGroup).sort((a, b) => b.finalScore - a.finalScore);
    const idx = sameCat.findIndex(s => s.vendorId === record.vendorId);
    return { rank: idx + 1, total: sameCat.length };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function VendorCompetitivenessDashboard() {
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState('score');
    const [drawerRow, setDrawerRow] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const rows = useMemo(() => {
        let data = [...ALL_SCORES];
        if (selectedCategory !== 'All') data = data.filter(r => r.category === selectedCategory);
        if (search) { const q = search.toLowerCase(); data = data.filter(r => `${r.vendorName} ${r.itemName} ${r.comparableGroup}`.toLowerCase().includes(q)); }
        if (sortBy === 'score') data.sort((a, b) => b.finalScore - a.finalScore);
        else if (sortBy === 'price') data.sort((a, b) => a.normalizedPrice - b.normalizedPrice);
        else if (sortBy === 'reliability') data.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
        else if (sortBy === 'category') data.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
        return data;
    }, [selectedCategory, search, sortBy]);

    const allScores = ALL_SCORES.map(r => r.finalScore);
    const avgScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);
    const topScore = Math.max(...allScores);
    const bottomScore = Math.min(...allScores);

    const kpis = [
        { label: 'Average Marketplace Score', value: avgScore, color: C.blue, icon: <FiActivity /> },
        { label: 'Top Vendor Score', value: topScore, color: C.green, icon: <FiAward /> },
        { label: 'Lowest Vendor Score', value: bottomScore, color: C.red, icon: <FiAlertTriangle /> },
        { label: 'Vendors Above 85', value: ALL_SCORES.filter(r => r.finalScore >= 85).length, color: C.green, icon: <FiCheckCircle /> },
        { label: 'Vendors Below 50', value: ALL_SCORES.filter(r => r.finalScore < 50).length, color: C.red, icon: <FiShield /> },
        { label: 'Avg Price Score', value: `${Math.round(ALL_SCORES.reduce((a, r) => a + r.factorBreakdown.price, 0) / ALL_SCORES.length)}/40`, color: C.amber, icon: <FiDollarSign /> },
    ];

    const handleRefresh = () => { setRefreshing(true); setTimeout(() => { setRefreshing(false); toast.success('Scores recalculated'); }, 800); };

    const thS = { padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
    const tdS = { padding: '12px 14px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)' };
    const trHover = { onMouseEnter: e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }, onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; }};

    return (
        <div style={{ padding: 24, paddingBottom: 100, position: 'relative' }}>

            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: C.fg }}>🏆 Vendor Competitiveness Score</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 14, maxWidth: 650 }}>
                        Marketplace ranking insights based on price competitiveness, reliability, availability, demand match, bundle completeness, and response speed.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <FiSearch size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                        <input placeholder="Search vendor or item…" value={search} onChange={e => setSearch(e.target.value)} style={{
                            padding: '8px 12px 8px 32px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, width: 220, outline: 'none',
                        }} />
                    </div>
                    <button onClick={handleRefresh} disabled={refreshing} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <FiRefreshCw size={14} /> Refresh Scores
                    </button>
                    <button onClick={() => toast.info('Export queued')} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.25)',
                        background: 'rgba(56,189,248,0.08)', color: C.blue, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <FiDownload size={14} /> Export Report
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

            {/* MARKETPLACE HEALTH ALERTS */}
            <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.fg, marginBottom: 10 }}>📡 Marketplace Health Alerts</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {HEALTH_ALERTS.map((a, i) => (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                            background: `${a.color}08`, border: `1px solid ${a.color}20`, borderRadius: 10,
                        }}>
                            <span style={{ fontSize: 16 }}>{a.icon}</span>
                            <span style={{ fontSize: 13, color: '#cbd5e1', flex: 1 }}>{a.text}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* FILTER / SORT BAR */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
                {CATEGORIES.map(cat => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} style={{
                        padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: selectedCategory === cat ? C.blue : 'rgba(255,255,255,0.04)',
                        color: selectedCategory === cat ? '#0f172a' : C.muted,
                        border: `1px solid ${selectedCategory === cat ? C.blue : 'rgba(255,255,255,0.1)'}`,
                        transition: 'all 0.15s',
                    }}>
                        {cat}
                    </button>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: C.muted }}>Sort:</span>
                    {SORT_OPTIONS.map(o => (
                        <button key={o.key} onClick={() => setSortBy(o.key)} style={{
                            padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            background: sortBy === o.key ? 'rgba(56,189,248,0.15)' : 'transparent',
                            color: sortBy === o.key ? C.blue : C.muted,
                            border: `1px solid ${sortBy === o.key ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.08)'}`,
                        }}>
                            {o.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* RANKING TABLE + DRAWER */}
            <div style={{ display: 'flex', gap: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={thS}>Rank</th><th style={thS}>Vendor</th><th style={thS}>Item</th>
                                    <th style={thS}>Group</th><th style={thS}>Price</th><th style={thS}>Price Position</th>
                                    <th style={thS}>Reliability</th><th style={thS}>Bundle</th><th style={thS}>Response</th>
                                    <th style={thS}>Score</th><th style={thS}>Band</th><th style={thS}>Badges</th>
                                    <th style={thS}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, idx) => {
                                    const sl = scoreLabel(r.finalScore);
                                    const pp = pricePosition(r);
                                    return (
                                        <tr key={`${r.vendorId}_${r.itemName}`} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                            <td style={{ ...tdS, fontWeight: 700, color: C.muted, width: 40 }}>{idx + 1}</td>
                                            <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.vendorName}</td>
                                            <td style={{ ...tdS, color: C.fg }}>{r.itemName}</td>
                                            <td style={tdS}><span style={{ background: 'rgba(148,163,184,0.1)', color: C.muted, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{r.comparableGroup}</span></td>
                                            <td style={{ ...tdS, color: C.fg, fontWeight: 600 }}>${r.normalizedPrice.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: pp.includes('1st') ? C.green : C.muted, fontSize: 12 }}>{pp}</td>
                                            <td style={{ ...tdS, color: r.reliabilityScore >= 0.85 ? C.green : r.reliabilityScore >= 0.7 ? C.amber : C.red, fontWeight: 600 }}>{reliabilityPct(r)}</td>
                                            <td style={{ ...tdS, color: r.bundleScore >= 1 ? C.green : r.bundleScore >= 0.5 ? C.amber : C.red, fontSize: 12 }}>{bundleStatus(r)}</td>
                                            <td style={{ ...tdS, color: r.responseScore >= 0.85 ? C.green : r.responseScore >= 0.6 ? C.amber : C.red, fontSize: 12 }}>{responseSpeed(r)}</td>
                                            <td style={{ ...tdS, fontWeight: 800, color: sl.color, fontSize: 17 }}>{r.finalScore}</td>
                                            <td style={tdS}><span style={{ background: `${sl.color}22`, color: sl.color, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{sl.text}</span></td>
                                            <td style={tdS}>
                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                    {(r.badges || []).map((b, bi) => (
                                                        <span key={bi} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${badgeColor[b] || C.muted}22`, color: badgeColor[b] || C.muted, whiteSpace: 'nowrap' }}>{b}</span>
                                                    ))}
                                                </div>
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
                                    <tr><td colSpan={13} style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>No vendors match filters</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* DETAIL DRAWER */}
                {drawerRow && <ScoreDetailDrawer record={drawerRow} onClose={() => setDrawerRow(null)} />}
            </div>
        </div>
    );
}

// ── Score Detail Drawer ───────────────────────────────────────────────────────
function ScoreDetailDrawer({ record, onClose }) {
    const sl = scoreLabel(record.finalScore);
    const suggestions = getImprovementSuggestions(record);
    const rank = vendorRank(record);
    const pp = pricePosition(record);
    const trendKey = `${record.vendorId}_${record.itemName}`;
    const trend = MOCK_TRENDS[trendKey] || [];

    // Comparable group price data
    const sameCat = ALL_SCORES.filter(s => s.comparableGroup === record.comparableGroup);
    const prices = sameCat.map(s => s.normalizedPrice).sort((a, b) => a - b);
    const lowestP = prices[0] || 0;
    const highestP = prices[prices.length - 1] || 0;
    const medianP = prices.length % 2 === 0 ? (prices[Math.floor(prices.length / 2) - 1] + prices[Math.floor(prices.length / 2)]) / 2 : prices[Math.floor(prices.length / 2)] || 0;

    // Reliability rank
    const byReliability = [...sameCat].sort((a, b) => b.reliabilityScore - a.reliabilityScore);
    const relRank = byReliability.findIndex(s => s.vendorId === record.vendorId) + 1;

    const fb = record.factorBreakdown;
    const factors = [
        { label: 'Price Competitiveness', value: fb.price, max: 40, color: C.green },
        { label: 'Reliability', value: fb.reliability, max: 25, color: C.blue },
        { label: 'Demand Match', value: fb.demandMatch, max: 15, color: C.amber },
        { label: 'Availability', value: fb.availability, max: 10, color: C.green },
        { label: 'Bundle Completeness', value: fb.bundle, max: 5, color: C.purple },
        { label: 'Response Speed', value: fb.response, max: 5, color: C.cyan },
    ];

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
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>{record.vendorName}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{record.itemName} • {record.comparableGroup}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}><FiX size={18} /></button>
            </div>

            {/* Overall Score */}
            <div style={{ padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                <div style={{ fontSize: 48, fontWeight: 900, color: sl.color, lineHeight: 1 }}>{record.finalScore}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: sl.color, marginTop: 4 }}>{sl.text}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Rank: <strong style={{ color: C.fg }}>{rank.rank} / {rank.total}</strong> in {record.comparableGroup}</div>
            </div>

            {/* Score Trend */}
            {trend.length > 0 && (
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>📈 Score Trend</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {trend.map((t, i) => {
                            const tsl = scoreLabel(t.score);
                            return (
                                <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                                    <div style={{
                                        height: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                                        borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.03)',
                                    }}>
                                        <div style={{
                                            width: '100%', height: `${Math.max(10, t.score)}%`,
                                            background: `${tsl.color}44`, borderRadius: '4px 4px 0 0',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 11, fontWeight: 700, color: tsl.color,
                                        }}>
                                            {t.score}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{t.week}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Factor Breakdown */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>🏆 Score Breakdown</div>
                {factors.map(f => (
                    <div key={f.label} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ color: C.muted }}>{f.label}</span>
                            <span style={{ fontWeight: 700, color: f.color }}>{f.value} / {f.max}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${(f.value / f.max) * 100}%`, background: f.color, borderRadius: 3 }} />
                        </div>
                    </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, marginTop: 12, padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ color: C.fg }}>Total Score</span>
                    <span style={{ color: sl.color }}>{record.finalScore} / 100</span>
                </div>
            </div>

            {/* Marketplace Comparison */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>📊 Marketplace Comparison</div>
                {[
                    ['Vendor Rank', `${rank.rank} / ${rank.total}`, C.fg],
                    ['Price Position', pp, pp.includes('1st') ? C.green : C.muted],
                    ['Reliability Rank', `${relRank} / ${sameCat.length}`, relRank === 1 ? C.green : C.fg],
                ].map(([l, v, c], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                        <span style={{ color: C.muted }}>{l}</span>
                        <span style={{ fontWeight: 600, color: c }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Price Position Analysis */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>💰 Price Position Analysis</div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Group: <strong style={{ color: C.fg }}>{record.comparableGroup}</strong></div>
                {[
                    ['Lowest Price', `$${lowestP.toFixed(2)}`, C.green],
                    ['Median Price', `$${medianP.toFixed(2)}`, C.fg],
                    ['Highest Price', `$${highestP.toFixed(2)}`, C.red],
                    ['Your Price', `$${record.normalizedPrice.toFixed(2)}`, C.blue],
                ].map(([l, v, c], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                        <span style={{ color: C.muted }}>{l}</span>
                        <span style={{ fontWeight: 700, color: c }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Improvement Suggestions */}
            {suggestions.length > 0 && (
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>💡 Improve Score</div>
                    {suggestions.map((s, i) => (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8,
                            padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                            border: '1px solid rgba(255,255,255,0.05)',
                        }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{s.icon}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, color: C.fg, lineHeight: 1.4 }}>{s.text}</div>
                                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                                    Potential: <span style={{ color: C.green, fontWeight: 700 }}>{s.potential}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Actions */}
            <div style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {['Send Score Report to Vendor', 'Queue Pricing Advisory', 'Review Comparable Mapping', 'Watch Vendor'].map((a, i) => (
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
