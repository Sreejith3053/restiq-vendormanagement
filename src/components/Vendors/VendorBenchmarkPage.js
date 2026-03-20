/**
 * VendorBenchmarkPage.js
 *
 * Anonymous Market Benchmark workspace for the vendor portal.
 * Shows the vendor's own items compared against anonymous market aggregates.
 * Integrated as a tab inside the Competitiveness Score page.
 *
 * PRIVACY: No competitor names, IDs, or exact vendor data is ever displayed.
 */
import React, { useState, useMemo } from 'react';
import useVendorBenchmark from '../../hooks/useVendorBenchmark';
import ItemInsightDrawer from './ItemInsightDrawer';

const C = {
    bg:     '#0d1520',
    card:   '#131d2e',
    border: 'rgba(255,255,255,0.07)',
    fg:     '#f8fafc',
    muted:  '#64748b',
    sub:    '#94a3b8',
    green:  '#34d399',
    blue:   '#38bdf8',
    amber:  '#fbbf24',
    red:    '#f87171',
    purple: '#a78bfa',
    orange: '#f97316',
};

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
    { value: 'impact',    label: 'Highest Demand Impact' },
    { value: 'gap',       label: 'Highest Price Gap' },
    { value: 'closest',  label: 'Closest to Market Best' },
    { value: 'confidence', label: 'Lowest Confidence' },
];

const BAND_FILTERS = [
    { value: '',               label: 'All Bands' },
    { value: 'market-leading',  label: '🏆 Market Leading' },
    { value: 'competitive',    label: '✅ Competitive' },
    { value: 'slightly-above', label: '📊 Slightly Above' },
    { value: 'high-price-risk', label: '🔴 High Price Risk' },
    { value: 'needs-review',   label: '⚠️ Needs Review' },
];

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, color, active, onClick }) {
    return (
        <div onClick={onClick} style={{
            background: active ? `${color}14` : 'rgba(255,255,255,0.03)',
            border: `1px solid ${active ? `${color}44` : C.border}`,
            borderRadius: 11, padding: '14px 16px',
            cursor: onClick ? 'pointer' : 'default',
            transition: 'all 0.2s',
        }}
        onMouseEnter={e => { if (onClick) { e.currentTarget.style.border = `1px solid ${color}44`; e.currentTarget.style.background = `${color}14`; }}}
        onMouseLeave={e => { if (!active) { e.currentTarget.style.border = `1px solid ${C.border}`; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}}>
            {icon && <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>}
            <div style={{ fontSize: 22, fontWeight: 700, color: color || C.fg, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 3 }}>{label}</div>
        </div>
    );
}

// ── Position band chip ────────────────────────────────────────────────────────
function BandChip({ band }) {
    if (!band) return null;
    return (
        <span style={{
            fontSize: 11, fontWeight: 700, color: band.color,
            background: band.bg, border: `1px solid ${band.color}33`,
            borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap',
        }}>
            {band.icon} {band.label}
        </span>
    );
}

// ── Guidance callouts (alert bar at top) ──────────────────────────────────────
function GuidanceBar({ records }) {
    const highRisk  = records.filter(r => r.positionBand.band === 'high-price-risk').length;
    const leading   = records.filter(r => r.positionBand.band === 'market-leading').length;
    const noData    = records.filter(r => !r.hasPackSize).length;
    const highDemGap= records.filter(r => r.demandTier === 'high' && ['slightly-above', 'high-price-risk'].includes(r.positionBand.band)).length;
    const items = [];
    if (highRisk > 0)   items.push({ icon: '🔴', text: `${highRisk} item${highRisk > 1 ? 's' : ''} priced significantly above market best`, color: C.red });
    if (leading > 0)    items.push({ icon: '🏆', text: `${leading} item${leading > 1 ? 's are' : ' is'} market-leading — keep it up`, color: C.green });
    if (highDemGap > 0) items.push({ icon: '🎯', text: `${highDemGap} high-demand item${highDemGap > 1 ? 's' : ''} may benefit from a pricing update`, color: C.amber });
    if (noData > 0)     items.push({ icon: '📦', text: `${noData} item${noData > 1 ? 's' : ''} need pack size for accurate comparison`, color: C.orange });
    if (items.length === 0) return null;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {items.map((it, i) => (
                <div key={i} style={{
                    padding: '9px 14px', borderRadius: 9, fontSize: 13,
                    background: `${it.color}09`, border: `1px solid ${it.color}22`,
                    color: it.color, display: 'flex', gap: 8, alignItems: 'center',
                }}>
                    <span>{it.icon}</span>{it.text}
                </div>
            ))}
        </div>
    );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ filtered }) {
    return (
        <tr>
            <td colSpan={11} style={{ padding: '48px 24px', textAlign: 'center', color: C.muted }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.sub }}>
                    {filtered ? 'No items match your filters' : 'No benchmarkable items yet'}
                </div>
                <div style={{ fontSize: 13, marginTop: 6, maxWidth: 400, margin: '8px auto 0' }}>
                    {filtered
                        ? 'Try adjusting filters or removing the opportunity toggle.'
                        : 'Items appear here once your catalog has pack sizes and at least one other market supplier lists the same item. Ensure your items have pack sizes and clean names to enable comparison.'}
                </div>
            </td>
        </tr>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VendorBenchmarkPage() {
    const { records, kpis, loading, error, refresh, lastFetched } = useVendorBenchmark();

    const [search,        setSearch]        = useState('');
    const [filterCategory,setFilterCategory]= useState('');
    const [filterBand,    setFilterBand]    = useState('');
    const [sortBy,        setSortBy]        = useState('impact');
    const [onlyOpps,      setOnlyOpps]      = useState(false);
    const [activKpi,      setActivKpi]      = useState(null);
    const [page,          setPage]          = useState(1);
    const [selectedRecord,setSelectedRecord]= useState(null);

    // ── KPI active-filter binding ─────────────────────────────────────────
    const handleKpiClick = (kpiKey) => {
        if (activKpi === kpiKey) { setActivKpi(null); setFilterBand(''); setOnlyOpps(false); return; }
        setActivKpi(kpiKey);
        if (kpiKey === 'competitive')  setFilterBand('competitive');
        if (kpiKey === 'aboveMarket')  setFilterBand('slightly-above');
        if (kpiKey === 'improvements') setOnlyOpps(true);
        setPage(1);
    };

    // ── Categories ────────────────────────────────────────────────────────
    const categories = useMemo(() => {
        const cats = new Set(records.map(r => r.category).filter(Boolean));
        return ['', ...cats];
    }, [records]);

    // ── Filtered list ─────────────────────────────────────────────────────
    const filtered = useMemo(() => {
        let list = [...records];
        if (search)         list = list.filter(r => r.itemName.toLowerCase().includes(search.toLowerCase()));
        if (filterCategory) list = list.filter(r => r.category === filterCategory);
        if (filterBand)     list = list.filter(r => r.positionBand.band === filterBand);
        if (onlyOpps)       list = list.filter(r => r.recommendations.some(rec => rec.type === 'warning' || rec.type === 'error'));

        // Sort
        if (sortBy === 'impact') {
            const bandOrder = { 'high-price-risk': 0, 'slightly-above': 1, 'competitive': 2, 'market-leading': 3, 'needs-review': 4 };
            list.sort((a, b) => (bandOrder[a.positionBand.band] ?? 5) - (bandOrder[b.positionBand.band] ?? 5));
        } else if (sortBy === 'gap') {
            list.sort((a, b) => (b.deltaBest ?? -999) - (a.deltaBest ?? -999));
        } else if (sortBy === 'closest') {
            list.sort((a, b) => (a.deltaBest ?? 999) - (b.deltaBest ?? 999));
        } else if (sortBy === 'confidence') {
            list.sort((a, b) => (a.confidencePct ?? 0) - (b.confidencePct ?? 0));
        }
        return list;
    }, [records, search, filterCategory, filterBand, onlyOpps, sortBy]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div style={{ paddingBottom: 60 }}>
            {/* Page header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: C.fg }}>📊 Market Benchmark</h2>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>
                        Anonymous comparison of your items against the marketplace. No competitor identities shown.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {lastFetched && <span style={{ fontSize: 11, color: C.muted }}>Updated {lastFetched.toLocaleTimeString()}</span>}
                    <button onClick={refresh} disabled={loading} style={{
                        padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: 'rgba(255,255,255,0.05)', color: C.sub, border: `1px solid ${C.border}`,
                        cursor: loading ? 'not-allowed' : 'pointer',
                    }}>
                        {loading ? '⟳ Loading…' : '⟳ Refresh'}
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div style={{ padding: 13, borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: C.red, fontSize: 13, marginBottom: 14 }}>
                    ⚠️ {error}
                </div>
            )}

            {/* KPI Row */}
            {kpis && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
                    <KpiCard icon="⚖️"  label="Items Benchmarked"        value={kpis.itemsBenchmarked}          color={C.blue}
                        active={activKpi === 'all'} onClick={() => handleKpiClick('all')} />
                    <KpiCard icon="✅"  label="Competitive Items"         value={kpis.competitiveItems}          color={C.green}
                        active={activKpi === 'competitive'} onClick={() => handleKpiClick('competitive')} />
                    <KpiCard icon="📈"  label="Above Market Items"        value={kpis.aboveMarketItems}          color={C.amber}
                        active={activKpi === 'aboveMarket'} onClick={() => handleKpiClick('aboveMarket')} />
                    <KpiCard icon="🎯"  label="Avg Gap to Market Best"    value={`${kpis.bestPriceProximity}%`}  color={kpis.bestPriceProximity <= 3 ? C.green : kpis.bestPriceProximity <= 8 ? C.amber : C.red} />
                    <KpiCard icon="💡"  label="Demand Opportunities"      value={kpis.demandGainOpportunities}   color={C.purple}
                        active={activKpi === 'demand'} onClick={() => handleKpiClick('demand')} />
                    <KpiCard icon="🔧"  label="Improvement Ops"           value={kpis.improvementOpportunities}  color={C.orange}
                        active={activKpi === 'improvements'} onClick={() => handleKpiClick('improvements')} />
                </div>
            )}

            {/* Guidance callouts */}
            {!loading && records.length > 0 && <GuidanceBar records={records} />}

            {/* Filter bar */}
            <div style={{
                display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
                padding: '12px 14px', marginBottom: 14,
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 11,
            }}>
                <input
                    placeholder="🔍 Search item…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    style={{ flex: '0 0 190px', padding: '7px 11px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, outline: 'none' }}
                />
                <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(1); }} style={ss}>
                    <option value="">All Categories</option>
                    {categories.filter(Boolean).map(c => <option key={c}>{c}</option>)}
                </select>
                <select value={filterBand} onChange={e => { setFilterBand(e.target.value); setActivKpi(null); setPage(1); }} style={ss}>
                    {BAND_FILTERS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={ss}>
                    {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.sub, cursor: 'pointer' }}>
                    <input type="checkbox" checked={onlyOpps} onChange={e => { setOnlyOpps(e.target.checked); setActivKpi(null); setPage(1); }} />
                    Opportunities Only
                </label>
                {(search || filterCategory || filterBand || onlyOpps || activKpi) && (
                    <button onClick={() => { setSearch(''); setFilterCategory(''); setFilterBand(''); setOnlyOpps(false); setActivKpi(null); setPage(1); }} style={{
                        padding: '6px 12px', borderRadius: 7, fontSize: 12, color: C.muted, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, cursor: 'pointer',
                    }}>✕ Clear</button>
                )}
            </div>

            {/* Main table */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${C.border}` }}>
                                {['Item', 'Category', 'Your Price', 'Market Best', 'Market Median', 'vs Best', 'vs Median', 'Position Band', 'Confidence', 'Recommendation', 'Action'].map(h => (
                                    <th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={11} style={{ padding: 40, textAlign: 'center', color: C.muted }}>
                                    <div style={{ fontSize: 24, marginBottom: 8 }}>📊</div>Loading benchmark data…
                                </td></tr>
                            ) : paginated.length === 0 ? (
                                <EmptyState filtered={!!(search || filterCategory || filterBand || onlyOpps)} />
                            ) : paginated.map((rec, i) => {
                                const { itemName, category, baseUnit, vendorUnitPrice, marketBest, marketMedian,
                                    deltaBest, deltaMedian, positionBand, confidence, primaryRec, isComparable } = rec;
                                const fmtD = (d) => {
                                    if (d === null) return <span style={{ color: C.muted }}>—</span>;
                                    const color = d <= 0 ? C.green : d > 10 ? C.red : C.amber;
                                    return <span style={{ color, fontWeight: 600 }}>{d > 0 ? '+' : ''}{d}%</span>;
                                };
                                return (
                                    <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)`, transition: 'background 0.15s' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                        <td style={{ padding: '9px 12px', fontWeight: 600, color: C.fg, maxWidth: 160 }}>
                                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={itemName}>{itemName}</div>
                                        </td>
                                        <td style={{ padding: '9px 12px', color: C.sub }}>{category || '—'}</td>
                                        <td style={{ padding: '9px 12px', color: C.fg, fontWeight: 600 }}>
                                            {vendorUnitPrice != null ? `$${vendorUnitPrice.toFixed(4)}` : '—'}
                                            {baseUnit && <span style={{ fontSize: 10, color: C.muted }}>/{baseUnit}</span>}
                                        </td>
                                        <td style={{ padding: '9px 12px', color: C.green }}>
                                            {marketBest != null ? `$${marketBest.toFixed(4)}` : <span style={{ color: C.muted }}>—</span>}
                                        </td>
                                        <td style={{ padding: '9px 12px', color: C.amber }}>
                                            {marketMedian != null ? `$${marketMedian.toFixed(4)}` : <span style={{ color: C.muted }}>—</span>}
                                        </td>
                                        <td style={{ padding: '9px 12px' }}>{fmtD(deltaBest)}</td>
                                        <td style={{ padding: '9px 12px' }}>{fmtD(deltaMedian)}</td>
                                        <td style={{ padding: '9px 12px' }}><BandChip band={positionBand} /></td>
                                        <td style={{ padding: '9px 12px' }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: confidence.color }}>{confidence.label}</span>
                                        </td>
                                        <td style={{ padding: '9px 12px', maxWidth: 180 }}>
                                            {primaryRec ? (
                                                <span style={{ fontSize: 12, color: primaryRec.type === 'error' ? C.red : primaryRec.type === 'warning' ? C.amber : C.green }}>
                                                    {primaryRec.icon} {primaryRec.text.length > 45 ? primaryRec.text.slice(0, 45) + '…' : primaryRec.text}
                                                </span>
                                            ) : <span style={{ color: C.muted }}>—</span>}
                                        </td>
                                        <td style={{ padding: '9px 12px' }}>
                                            <button onClick={() => setSelectedRecord(rec)} style={{
                                                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                                                background: 'rgba(56,189,248,0.10)', color: C.blue,
                                                border: `1px solid ${C.blue}33`, cursor: 'pointer',
                                            }}>
                                                View Insight
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 12, color: C.muted }}>{filtered.length} items · page {page} of {totalPages}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...pBtn, opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...pBtn, opacity: page === totalPages ? 0.4 : 1 }}>Next →</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Privacy notice */}
            <div style={{ marginTop: 16, fontSize: 11, color: '#334155', fontStyle: 'italic', textAlign: 'center' }}>
                All market data is anonymous. No competitor names, vendor identities, or item lists are revealed.
            </div>

            {/* Item insight drawer */}
            {selectedRecord && (
                <ItemInsightDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} />
            )}
        </div>
    );
}

const ss = {
    padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(255,255,255,0.04)', color: '#f8fafc', fontSize: 13, outline: 'none', minWidth: 130,
};
const pBtn = {
    padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
    background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer',
};
