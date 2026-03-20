/**
 * VendorComparisonPage.js
 *
 * SuperAdmin Vendor Comparison Engine.
 * Compares vendors for the same normalized catalog items,
 * shows savings opportunities, and recommends best vendors.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import KPIStatsRow from '../Consolidated/KPIStatsRow';
import ComparisonDetailDrawer from './ComparisonDetailDrawer';
import useVendorComparison from '../../hooks/useVendorComparison';
import { BADGE_CONFIG } from '../Vendors/vendorComparisonEngine';

const C = {
    bg:      '#0d1520',
    card:    '#131d2e',
    border:  'rgba(255,255,255,0.07)',
    fg:      '#f8fafc',
    muted:   '#64748b',
    sub:     '#94a3b8',
    green:   '#34d399',
    blue:    '#38bdf8',
    amber:   '#fbbf24',
    red:     '#f87171',
    purple:  '#a78bfa',
};

const PAGE_SIZE = 25;
const COMPARE_MODES = [
    { value: 'price',       label: 'Price Only' },
    { value: 'price+rel',   label: 'Price + Reliability' },
    { value: 'full',        label: 'Price + Reliability + Capacity' },
];

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfidenceBadge({ pct }) {
    const color = pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red;
    return (
        <span style={{
            fontSize: 11, fontWeight: 700, color,
            background: `${color}14`, border: `1px solid ${color}33`,
            borderRadius: 6, padding: '2px 8px',
        }}>
            {pct}%
        </span>
    );
}

// ── Action menu ───────────────────────────────────────────────────────────────
function ActionMenu({ group, onView, onReview, navigate }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ position: 'relative' }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                    background: 'rgba(56,189,248,0.10)', color: C.blue,
                    border: `1px solid ${C.blue}33`, cursor: 'pointer',
                }}
            >
                Actions ▾
            </button>
            {open && (
                <>
                    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
                    <div style={{
                        position: 'absolute', right: 0, top: '110%', zIndex: 10,
                        background: '#1a2740', border: `1px solid ${C.border}`,
                        borderRadius: 10, minWidth: 190, overflow: 'hidden',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                    }}>
                        {[
                            { label: '🔍 View Comparison', onClick: () => { onView(group); setOpen(false); } },
                            { label: '🏭 Open Best Vendor', onClick: () => { if (group.lowestVendorId) navigate(`/vendors/${group.lowestVendorId}`); setOpen(false); } },
                            { label: '📦 View Allocation Impact', onClick: () => { navigate('/intelligence?tab=allocation'); setOpen(false); } },
                            group.comparability?.status !== 'comparable' && { label: '⚠️ Send to Review', onClick: () => { onReview(group); setOpen(false); } },
                        ].filter(Boolean).map((item, i) => (
                            <button key={i} onClick={item.onClick} style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '10px 14px', background: 'transparent',
                                border: 'none', borderBottom: `1px solid ${C.border}`,
                                color: C.fg, fontSize: 13, cursor: 'pointer',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ filtered }) {
    return (
        <tr>
            <td colSpan={13} style={{ padding: '48px 24px', textAlign: 'center', color: C.muted }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⚖️</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.sub }}>
                    {filtered ? 'No items match your filters' : 'No comparable items found'}
                </div>
                <div style={{ fontSize: 13, marginTop: 6 }}>
                    Items appear here when at least 2 vendors offer the same catalog item with valid pack sizes.
                </div>
            </td>
        </tr>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VendorComparisonPage() {
    const navigate = useNavigate();
    const { groups, nonComparable, kpis, loading, error, refresh, lastFetched } = useVendorComparison();

    const [search,         setSearch]         = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [filterVendor,   setFilterVendor]   = useState('');
    const [compareMode,    setCompareMode]     = useState('price+rel');
    const [minConfidence,  setMinConfidence]   = useState(0);
    const [showReview,     setShowReview]      = useState(false);
    const [page,           setPage]            = useState(1);
    const [selectedGroup,  setSelectedGroup]   = useState(null);
    const [reviewNotices,  setReviewNotices]   = useState([]);

    // ── Derived filter options ─────────────────────────────────────────────
    const categories = useMemo(() => {
        const cats = new Set(groups.map(g => g.category).filter(Boolean));
        return ['', ...cats];
    }, [groups]);

    const vendors = useMemo(() => {
        const vs = new Set();
        groups.forEach(g => g.vendors?.forEach(v => vs.add(v.vendorName)));
        return ['', ...vs];
    }, [groups]);

    // ── Filtered + sorted groups ───────────────────────────────────────────
    const filtered = useMemo(() => {
        let list = showReview ? nonComparable : groups;
        if (search) list = list.filter(g => g.itemName?.toLowerCase().includes(search.toLowerCase()));
        if (filterCategory) list = list.filter(g => g.category === filterCategory);
        if (filterVendor)   list = list.filter(g => g.vendors?.some(v => v.vendorName === filterVendor));
        if (minConfidence > 0) list = list.filter(g => (g.comparability?.confidence || 0) >= minConfidence);
        return list;
    }, [groups, nonComparable, search, filterCategory, filterVendor, minConfidence, showReview]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const handleView   = useCallback((group) => setSelectedGroup(group), []);
    const handleReview = useCallback((group) => {
        setReviewNotices(prev => [...prev, group.itemName]);
    }, []);

    const resetPage = useCallback(() => setPage(1), []);

    // ── KPI cards ─────────────────────────────────────────────────────────
    const kpiCards = kpis ? [
        { label: 'Comparable Items',     value: kpis.comparableItems,                icon: '⚖️',  color: C.blue  },
        { label: 'Vendors Compared',     value: kpis.vendorsCompared,                icon: '🏭',  color: C.purple },
        { label: 'Monthly Savings Pot.', value: `$${(kpis.monthlySavings || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, icon: '💰', color: C.green },
        { label: 'Avg Market Spread',    value: `${kpis.avgMarketSpread}%`,           icon: '📊',  color: C.amber },
        { label: 'Needs Review',         value: kpis.needsReview,                    icon: '⚠️',  color: C.red   },
        { label: 'Best Opportunity',     value: kpis.bestOpportunity,                icon: '🎯',  color: C.green },
    ] : [];

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div style={{ padding: '4px 0 60px' }}>

            {/* KPI Row */}
            {kpis && <KPIStatsRow stats={kpiCards} />}

            {/* Error banner */}
            {error && (
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: C.red, fontSize: 13, marginBottom: 16 }}>
                    ⚠️ {error}
                </div>
            )}

            {/* Review notices */}
            {reviewNotices.length > 0 && (
                <div style={{ padding: 12, borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: C.amber, fontSize: 13, marginBottom: 16 }}>
                    ✅ Sent to review queue: {reviewNotices.join(', ')}
                </div>
            )}

            {/* ── Filter Bar ── */}
            <div style={{
                display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
                padding: '14px 16px', marginBottom: 16,
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            }}>
                <input
                    placeholder="🔍 Search item..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); resetPage(); }}
                    style={{ flex: '0 0 200px', padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, outline: 'none' }}
                />
                <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); resetPage(); }} style={selectStyle}>
                    <option value="">All Categories</option>
                    {categories.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterVendor} onChange={e => { setFilterVendor(e.target.value); resetPage(); }} style={selectStyle}>
                    <option value="">All Vendors</option>
                    {vendors.filter(Boolean).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={compareMode} onChange={e => setCompareMode(e.target.value)} style={selectStyle}>
                    {COMPARE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <select value={minConfidence} onChange={e => { setMinConfidence(Number(e.target.value)); resetPage(); }} style={selectStyle}>
                    <option value={0}>Any Confidence</option>
                    <option value={50}>≥50% Confidence</option>
                    <option value={80}>≥80% Confidence</option>
                    <option value={95}>≥95% Confidence</option>
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: C.sub, cursor: 'pointer', marginLeft: 8 }}>
                    <input type="checkbox" checked={showReview} onChange={e => { setShowReview(e.target.checked); resetPage(); }} />
                    Show Needs Review ({nonComparable.length})
                </label>

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
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

            {/* ── Main Table ── */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${C.border}` }}>
                                {[
                                    'Item', 'Category', 'Base Unit', 'Lowest Vendor',
                                    'Lowest Price', 'Median Price', 'Highest', 'Spread %',
                                    'Vendors', 'Mo. Usage', 'Mo. Savings', 'Confidence', 'Action',
                                ].map(h => (
                                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={13} style={{ padding: 40, textAlign: 'center', color: C.muted }}>
                                    <div style={{ fontSize: 24, marginBottom: 8 }}>⚖️</div>
                                    Loading comparison data…
                                </td></tr>
                            ) : paginated.length === 0 ? (
                                <EmptyState filtered={search || filterCategory || filterVendor} />
                            ) : paginated.map((group, i) => {
                                const { itemName, category, baseUnit, stats, lowestVendor, savings, comparability, monthlyUsage, vendors: gVendors } = group;
                                const isReview = comparability?.status !== 'comparable';
                                return (
                                    <tr key={i} style={{
                                        borderBottom: `1px solid rgba(255,255,255,0.04)`,
                                        background: isReview ? 'rgba(251,191,36,0.03)' : 'transparent',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = isReview ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.025)'}
                                    onMouseLeave={e => e.currentTarget.style.background = isReview ? 'rgba(251,191,36,0.03)' : 'transparent'}>
                                        <td style={{ padding: '10px 12px', fontWeight: 600, color: C.fg, maxWidth: 180 }}>
                                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={itemName}>{itemName}</div>
                                        </td>
                                        <td style={{ padding: '10px 12px', color: C.sub }}>{category || '—'}</td>
                                        <td style={{ padding: '10px 12px', color: C.sub }}>{baseUnit || '—'}</td>
                                        <td style={{ padding: '10px 12px', color: C.green, fontWeight: 600 }}>{lowestVendor || '—'}</td>
                                        <td style={{ padding: '10px 12px', fontWeight: 700, color: C.green }}>
                                            {stats?.lowest != null ? `$${stats.lowest.toFixed(4)}` : '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px', color: C.amber }}>
                                            {stats?.median != null ? `$${stats.median.toFixed(4)}` : '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px', color: C.red }}>
                                            {stats?.highest != null ? `$${stats.highest.toFixed(4)}` : '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <span style={{ color: (stats?.spread || 0) > 20 ? C.red : (stats?.spread || 0) > 10 ? C.amber : C.sub, fontWeight: 600 }}>
                                                {stats?.spread != null ? `${stats.spread}%` : '—'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 12px', color: C.sub, textAlign: 'center' }}>{stats?.vendorCount || '—'}</td>
                                        <td style={{ padding: '10px 12px', color: C.sub }}>
                                            {monthlyUsage > 0 ? `${monthlyUsage.toFixed(0)} ${baseUnit}` : '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            {savings?.monthly > 0
                                                ? <span style={{ color: C.green, fontWeight: 700 }}>${savings.monthly.toFixed(2)}</span>
                                                : <span style={{ color: C.muted }}>—</span>
                                            }
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <ConfidenceBadge pct={comparability?.confidence || 0} />
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <ActionMenu group={group} onView={handleView} onReview={handleReview} navigate={navigate} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 12, color: C.muted }}>{filtered.length} items — page {page} of {totalPages}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                style={{ ...paginBtn, opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                                style={{ ...paginBtn, opacity: page === totalPages ? 0.4 : 1 }}>Next →</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail drawer */}
            {selectedGroup && (
                <ComparisonDetailDrawer
                    group={selectedGroup}
                    onClose={() => setSelectedGroup(null)}
                />
            )}
        </div>
    );
}

// ── Shared style objects ──────────────────────────────────────────────────────
const selectStyle = {
    padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(255,255,255,0.04)', color: '#f8fafc', fontSize: 13, outline: 'none',
    minWidth: 130,
};
const paginBtn = {
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer',
};
