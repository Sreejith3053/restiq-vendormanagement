/**
 * MarketplaceIntelligencePage.js
 *
 * Admin-only intelligence hub for vendor pricing, restaurant savings,
 * bundle gaps, substitution opportunities, and market movement.
 */
import React, { useState, useMemo } from 'react';
import {
    FiRefreshCw, FiDownload, FiSearch, FiX, FiChevronRight,
    FiTrendingUp, FiTrendingDown, FiAlertTriangle, FiCheckCircle,
    FiShield, FiPackage, FiDollarSign, FiActivity, FiLayers, FiEye, FiAward,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { generateMockScores, scoreLabel } from '../Vendors/vendorCompetitivenessEngine';

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
    { key: 'price',        label: '💰 Price Intelligence' },
    { key: 'savings',      label: '📉 Savings Opportunities' },
    { key: 'bundle',       label: '🔗 Bundle Intelligence' },
    { key: 'substitution', label: '🔄 Substitution Intelligence' },
    { key: 'watch',        label: '📈 Market Watch' },
    { key: 'scores',       label: '🏆 Vendor Scores' },
];

const MOCK_SCORES = generateMockScores();
const scoreLabelColor = { Excellent: '#34d399', Strong: '#38bdf8', Competitive: '#fbbf24', Weak: '#f97316', 'At Risk': '#f87171' };

const CATEGORIES = ['All', 'Produce', 'Packaging', 'Cleaning Supplies', 'Spices', 'Meat', 'Dairy'];

// ── Mock Data ─────────────────────────────────────────────────────────────────
const MOCK_PRICE_INTEL = [
    { id: 1, group: 'red_onion_25lb', category: 'Produce', lowest: 19.00, median: 19.75, highest: 21.00, spread: 2.00, vendors: 3, volatility: 'Medium', trend: '+3.2%', confidence: 'High' },
    { id: 2, group: 'coriander_fresh_1lb', category: 'Produce', lowest: 8.00, median: 9.00, highest: 11.50, spread: 3.50, vendors: 4, volatility: 'High', trend: '+5.1%', confidence: 'High' },
    { id: 3, group: 'peeled_garlic_5lb', category: 'Produce', lowest: 20.50, median: 21.25, highest: 22.00, spread: 1.50, vendors: 2, volatility: 'Low', trend: '-1.0%', confidence: 'Medium' },
    { id: 4, group: 'chicken_breast_10lb', category: 'Meat', lowest: 28.00, median: 30.50, highest: 34.00, spread: 6.00, vendors: 3, volatility: 'High', trend: '+7.3%', confidence: 'High' },
    { id: 5, group: 'basmati_rice_25lb', category: 'Spices', lowest: 22.00, median: 23.50, highest: 26.00, spread: 4.00, vendors: 5, volatility: 'Medium', trend: '+2.1%', confidence: 'High' },
    { id: 6, group: '8oz_soup_cups_500ct', category: 'Packaging', lowest: 42.00, median: 44.50, highest: 48.00, spread: 6.00, vendors: 3, volatility: 'Low', trend: '-0.5%', confidence: 'High' },
    { id: 7, group: 'cumin_powder_5lb', category: 'Spices', lowest: 15.00, median: 16.50, highest: 19.00, spread: 4.00, vendors: 4, volatility: 'Medium', trend: '+1.8%', confidence: 'Medium' },
    { id: 8, group: 'mozzarella_5lb', category: 'Dairy', lowest: 18.00, median: 19.00, highest: 21.50, spread: 3.50, vendors: 3, volatility: 'High', trend: '+4.5%', confidence: 'High' },
];

const MOCK_SAVINGS = [
    { id: 1, restaurant: 'Oruma Takeout', item: 'Red Onion', currentPrice: 19.50, bestPrice: 18.50, savings: 1.00, monthlyUsage: 48, monthlySavings: 48.00, confidence: 'High', vendor: 'ON Thyme', bestVendor: 'Test Taas' },
    { id: 2, restaurant: 'Oruma Takeout', item: 'Coriander Leaves', currentPrice: 9.50, bestPrice: 8.00, savings: 1.50, monthlyUsage: 40, monthlySavings: 60.00, confidence: 'High', vendor: 'Vendor A', bestVendor: 'ON Thyme' },
    { id: 3, restaurant: 'Oruma Takeout', item: 'Peeled Garlic', currentPrice: 22.00, bestPrice: 20.50, savings: 1.50, monthlyUsage: 24, monthlySavings: 36.00, confidence: 'Medium', vendor: 'Vendor A', bestVendor: 'Test Taas' },
    { id: 4, restaurant: 'Spice Garden', item: 'Chicken Breast', currentPrice: 34.00, bestPrice: 28.00, savings: 6.00, monthlyUsage: 20, monthlySavings: 120.00, confidence: 'High', vendor: 'Vendor B', bestVendor: 'ON Thyme' },
    { id: 5, restaurant: 'Spice Garden', item: 'Basmati Rice', currentPrice: 26.00, bestPrice: 22.00, savings: 4.00, monthlyUsage: 12, monthlySavings: 48.00, confidence: 'Medium', vendor: 'Vendor C', bestVendor: 'Test Taas' },
];

const MOCK_BUNDLES = [
    { id: 1, group: '8oz_soup_family', primary: '8oz Soup Cups', companion: '8oz Soup Cup Lids', expectedRatio: '1:1', actualRatio: '1:0.72', risk: 'High', weeklyMisses: 4, recommendation: 'Alert on missing lids' },
    { id: 2, group: '16oz_clear_family', primary: '16oz Clear Container', companion: '16oz Clear Lid', expectedRatio: '1:1', actualRatio: '1:0.85', risk: 'Medium', weeklyMisses: 2, recommendation: 'Suggest lid add-on' },
    { id: 3, group: 'T28_family', primary: 'T28 Container', companion: 'T28 Clear Lid', expectedRatio: '1:1', actualRatio: '1:0.90', risk: 'Low', weeklyMisses: 1, recommendation: 'Monitor only' },
    { id: 4, group: 'RC24_family', primary: 'RC24 Container', companion: 'RC24 Lid', expectedRatio: '1:1', actualRatio: '1:0.65', risk: 'High', weeklyMisses: 5, recommendation: 'Auto-prompt for lid' },
    { id: 5, group: '12oz_soup_family', primary: '12oz Soup Cups', companion: '12oz Soup Cup Lids', expectedRatio: '1:1', actualRatio: '1:0.88', risk: 'Medium', weeklyMisses: 2, recommendation: 'Suggest lid add-on' },
];

const MOCK_SUBSTITUTIONS = [
    { id: 1, item: 'Red Onion (25lb)', bestSub: 'Cooking Onion (25lb)', matchType: 'Exact Comparable', priceDiff: '-$0.50', confidence: 'High', notes: 'Same use-case, minor taste variance' },
    { id: 2, item: 'Coriander Fresh (1lb)', bestSub: 'Cilantro Bunch (1lb)', matchType: 'Exact Comparable', priceDiff: '+$0.25', confidence: 'High', notes: 'Regional naming difference' },
    { id: 3, item: 'Basmati Rice (10lb)', bestSub: 'Basmati Rice (25lb)', matchType: 'Pack-Normalized', priceDiff: '-$1.20/lb', confidence: 'High', notes: 'Better value per unit at larger pack' },
    { id: 4, item: 'Chicken Breast (10lb)', bestSub: 'Chicken Thigh (10lb)', matchType: 'Near Comparable', priceDiff: '-$4.00', confidence: 'Low', notes: 'Different cut — verify recipe suitability' },
    { id: 5, item: '8oz Soup Cups (500ct)', bestSub: '8oz Soup Cups (250ct)', matchType: 'Pack-Normalized', priceDiff: '+$0.02/unit', confidence: 'Medium', notes: 'Slightly more per unit at smaller pack' },
];

const MOCK_MARKET_WATCH = [
    { id: 1, group: 'red_onion_25lb', trend: '+3.2%', lowest: 19.00, median: 19.75, volatility: 'Medium', newEntry: true, signal: 'Opportunity' },
    { id: 2, group: 'chicken_breast_10lb', trend: '+7.3%', lowest: 28.00, median: 30.50, volatility: 'High', newEntry: false, signal: 'Risk' },
    { id: 3, group: 'coriander_fresh_1lb', trend: '+5.1%', lowest: 8.00, median: 9.00, volatility: 'High', newEntry: true, signal: 'Opportunity' },
    { id: 4, group: '8oz_soup_cups_500ct', trend: '-0.5%', lowest: 42.00, median: 44.50, volatility: 'Low', newEntry: false, signal: 'Stable' },
    { id: 5, group: 'mozzarella_5lb', trend: '+4.5%', lowest: 18.00, median: 19.00, volatility: 'High', newEntry: true, signal: 'Risk' },
    { id: 6, group: 'peeled_garlic_5lb', trend: '-1.0%', lowest: 20.50, median: 21.25, volatility: 'Low', newEntry: false, signal: 'Falling' },
];

// ── Style Tokens ──────────────────────────────────────────────────────────────
const C = {
    green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8',
    purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc',
};

const riskColor = { Low: C.green, Medium: C.amber, High: C.red, Critical: C.red };
const signalColor = { Opportunity: C.green, Risk: C.red, Stable: C.blue, Falling: C.amber };
const confColor = { High: C.green, Medium: C.amber, Low: C.red };
const matchTypeColor = { 'Exact Comparable': C.green, 'Pack-Normalized': C.blue, 'Near Comparable': C.amber };
const badgeColor = { 'Best Overall Choice': C.green, 'Lowest Price': C.blue, 'Most Reliable': C.purple };

// ── Detail Drawer Items Builder ───────────────────────────────────────────────
function buildDrawerContent(tab, row) {
    if (!row) return null;
    switch (tab) {
        case 'price':
            return {
                title: row.group, subtitle: row.category,
                sections: [
                    { heading: '📊 Price Range', rows: [
                        ['Lowest Active Price', `$${row.lowest.toFixed(2)}`, C.green],
                        ['Median Active Price', `$${row.median.toFixed(2)}`, C.fg],
                        ['Highest Active Price', `$${row.highest.toFixed(2)}`, C.red],
                        ['Price Spread', `$${row.spread.toFixed(2)}`, C.amber],
                    ]},
                    { heading: '📈 Market Context', rows: [
                        ['Active Vendors', row.vendors, C.blue],
                        ['4-Week Trend', row.trend, row.trend.startsWith('+') ? C.green : C.red],
                        ['Volatility', row.volatility, riskColor[row.volatility]],
                        ['Confidence', row.confidence, confColor[row.confidence]],
                    ]},
                    { heading: '💡 Recommendations', rows: [
                        ['Aggressive Price', `$${(row.lowest * 0.975).toFixed(2)}`, C.green],
                        ['Competitive Match', `$${row.lowest.toFixed(2)}`, C.blue],
                        ['Safe Range', `$${row.lowest.toFixed(2)} – $${row.median.toFixed(2)}`, C.fg],
                    ]},
                ],
                actions: ['Queue Vendor Pricing Advisory', 'Review Comparable Mapping', 'Watch Item'],
            };
        case 'savings':
            return {
                title: `${row.item} — ${row.restaurant}`, subtitle: 'Savings Opportunity',
                sections: [
                    { heading: '💰 Savings Detail', rows: [
                        ['Current Vendor', row.vendor, C.fg],
                        ['Current Price', `$${row.currentPrice.toFixed(2)}`, C.red],
                        ['Best Available Vendor', row.bestVendor, C.fg],
                        ['Best Available Price', `$${row.bestPrice.toFixed(2)}`, C.green],
                        ['Savings Per Unit', `$${row.savings.toFixed(2)}`, C.amber],
                    ]},
                    { heading: '📦 Usage & Impact', rows: [
                        ['Monthly Usage (units)', row.monthlyUsage, C.blue],
                        ['Est. Monthly Savings', `$${row.monthlySavings.toFixed(2)}`, C.green],
                        ['Est. Annual Savings', `$${(row.monthlySavings * 12).toFixed(2)}`, C.green],
                        ['Confidence', row.confidence, confColor[row.confidence]],
                    ]},
                ],
                actions: ['Queue Savings Alert', 'Recommend in Suggested Orders', 'View Comparison', 'Mark Ignore'],
            };
        case 'bundle':
            return {
                title: row.group, subtitle: 'Compatibility Group',
                sections: [
                    { heading: '🔗 Pair Info', rows: [
                        ['Primary Item', row.primary, C.fg],
                        ['Companion Item', row.companion, C.fg],
                        ['Expected Ratio', row.expectedRatio, C.blue],
                        ['Actual Purchase Ratio', row.actualRatio, riskColor[row.risk]],
                    ]},
                    { heading: '⚠️ Risk Assessment', rows: [
                        ['Missing Pair Risk', row.risk, riskColor[row.risk]],
                        ['Weekly Missed Pairs', row.weeklyMisses, C.amber],
                        ['Recommendation', row.recommendation, C.fg],
                    ]},
                ],
                actions: ['Queue Bundle Alert', 'Review Compatibility Mapping', 'Mark Ignore'],
            };
        case 'substitution':
            return {
                title: row.item, subtitle: 'Substitution Options',
                sections: [
                    { heading: '🔄 Best Substitute', rows: [
                        ['Substitute Item', row.bestSub, C.fg],
                        ['Match Type', row.matchType, matchTypeColor[row.matchType]],
                        ['Price Difference', row.priceDiff, row.priceDiff.startsWith('-') ? C.green : C.amber],
                        ['Confidence', row.confidence, confColor[row.confidence]],
                        ['Notes', row.notes, C.muted],
                    ]},
                ],
                actions: ['Recommend as Backup', 'Review Mapping', 'Mark Ignore'],
            };
        case 'watch':
            return {
                title: row.group, subtitle: 'Market Watch',
                sections: [
                    { heading: '📈 Trend Data', rows: [
                        ['4-Week Trend', row.trend, row.trend.startsWith('+') ? C.green : C.red],
                        ['Current Lowest', `$${row.lowest.toFixed(2)}`, C.green],
                        ['Current Median', `$${row.median.toFixed(2)}`, C.fg],
                        ['Volatility', row.volatility, riskColor[row.volatility]],
                        ['New Vendor Entry', row.newEntry ? 'Yes' : 'No', row.newEntry ? C.green : C.muted],
                        ['Signal', row.signal, signalColor[row.signal]],
                    ]},
                ],
                actions: ['Watch Item', 'Queue Vendor Advisory', 'Review Comparable Mapping'],
            };
        case 'scores': {
            const sl = scoreLabel(row.finalScore);
            return {
                title: `${row.vendorName} — ${row.itemName}`, subtitle: `Score: ${row.finalScore}/100 (${sl.text})`,
                sections: [
                    { heading: '🏆 Factor Breakdown', rows: [
                        ['Price Position', `${row.factorBreakdown.price}/40`, row.factorBreakdown.price >= 30 ? C.green : row.factorBreakdown.price >= 20 ? C.amber : C.red],
                        ['Reliability', `${row.factorBreakdown.reliability}/25`, row.factorBreakdown.reliability >= 18 ? C.green : row.factorBreakdown.reliability >= 12 ? C.amber : C.red],
                        ['Demand Match', `${row.factorBreakdown.demandMatch}/15`, row.factorBreakdown.demandMatch >= 10 ? C.green : C.amber],
                        ['Availability', `${row.factorBreakdown.availability}/10`, row.factorBreakdown.availability >= 8 ? C.green : C.amber],
                        ['Bundle', `${row.factorBreakdown.bundle}/5`, row.factorBreakdown.bundle >= 4 ? C.green : C.amber],
                        ['Response', `${row.factorBreakdown.response}/5`, row.factorBreakdown.response >= 4 ? C.green : C.amber],
                    ]},
                    { heading: '📊 Raw Scores', rows: [
                        ['Price Score', row.priceScore.toFixed(3), C.fg],
                        ['Reliability Score', row.reliabilityScore.toFixed(3), C.fg],
                        ['Demand Match Score', row.demandMatchScore.toFixed(3), C.fg],
                        ['Availability Score', row.availabilityScore.toFixed(3), C.fg],
                        ['Bundle Score', row.bundleScore.toFixed(3), C.fg],
                        ['Response Score', row.responseScore.toFixed(3), C.fg],
                    ]},
                    { heading: '📋 Meta', rows: [
                        ['Comparable Group', row.comparableGroup, C.fg],
                        ['Normalized Price', `$${row.normalizedPrice.toFixed(2)}`, C.fg],
                        ['Score Version', row.scoreVersion, C.muted],
                    ]},
                ],
                actions: ['Send Score Report to Vendor', 'Queue Pricing Advisory', 'Review Comparable Mapping'],
            };
        }
        default: return null;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function MarketplaceIntelligencePage() {
    const [activeTab, setActiveTab] = useState('price');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [search, setSearch] = useState('');
    const [drawerRow, setDrawerRow] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    // ── Filter logic ──────────────────────────────────────────────────────────
    const filterRows = (rows) => rows.filter(r => {
        const cat = selectedCategory;
        if (cat !== 'All') {
            const rowCat = r.category || '';
            if (rowCat && rowCat !== cat) return false;
        }
        if (search) {
            const q = search.toLowerCase();
            const haystack = Object.values(r).join(' ').toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    });

    const priceRows = useMemo(() => filterRows(MOCK_PRICE_INTEL), [selectedCategory, search]);
    const savingsRows = useMemo(() => filterRows(MOCK_SAVINGS), [selectedCategory, search]);
    const bundleRows = useMemo(() => filterRows(MOCK_BUNDLES), [selectedCategory, search]);
    const subRows = useMemo(() => filterRows(MOCK_SUBSTITUTIONS), [selectedCategory, search]);
    const watchRows = useMemo(() => filterRows(MOCK_MARKET_WATCH), [selectedCategory, search]);
    const scoreRows = useMemo(() => {
        return MOCK_SCORES.filter(r => {
            if (selectedCategory !== 'All' && r.category && r.category !== selectedCategory) return false;
            if (search) {
                const q = search.toLowerCase();
                const h = `${r.vendorName} ${r.itemName} ${r.comparableGroup}`.toLowerCase();
                if (!h.includes(q)) return false;
            }
            return true;
        }).sort((a, b) => b.finalScore - a.finalScore);
    }, [selectedCategory, search]);

    // ── KPI Counts ────────────────────────────────────────────────────────────
    const kpis = [
        { label: 'Vendors Above Market', value: MOCK_PRICE_INTEL.filter(r => r.spread > 2).length, icon: <FiAlertTriangle />, color: C.red },
        { label: 'Savings Opportunities', value: MOCK_SAVINGS.length, icon: <FiDollarSign />, color: C.green },
        { label: 'High Spread Groups', value: MOCK_PRICE_INTEL.filter(r => r.spread >= 4).length, icon: <FiActivity />, color: C.amber },
        { label: 'Missing Bundle Risks', value: MOCK_BUNDLES.filter(r => r.risk === 'High').length, icon: <FiPackage />, color: C.purple },
        { label: 'Strong Substitutes', value: MOCK_SUBSTITUTIONS.filter(r => r.confidence === 'High').length, icon: <FiLayers />, color: C.blue },
        { label: 'Volatility Alerts', value: MOCK_PRICE_INTEL.filter(r => r.volatility === 'High').length, icon: <FiShield />, color: C.cyan },
    ];

    const handleRefresh = () => {
        setRefreshing(true);
        setTimeout(() => { setRefreshing(false); toast.success('Intelligence data refreshed'); }, 800);
    };

    const handleExport = () => toast.info('Export queued — CSV will download shortly');

    // ── Shared table styles ───────────────────────────────────────────────────
    const thS = { padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
    const tdS = { padding: '12px 14px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.05)' };
    const trHover = {
        onMouseEnter: e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; },
        onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; },
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{ padding: 24, paddingBottom: 100, position: 'relative' }}>

            {/* ══ HEADER ══ */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: C.fg }}>📊 Marketplace Intelligence</h1>
                    <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 14, maxWidth: 600 }}>
                        Monitor pricing competitiveness, savings opportunities, compatibility gaps, and substitution intelligence across the marketplace.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <FiSearch size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                        <input
                            placeholder="Search item or group…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{
                                padding: '8px 12px 8px 32px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, width: 220, outline: 'none',
                            }}
                        />
                    </div>
                    <button onClick={handleRefresh} disabled={refreshing} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <FiRefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh
                    </button>
                    <button onClick={handleExport} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.25)',
                        background: 'rgba(56,189,248,0.08)', color: C.blue, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <FiDownload size={14} /> Export Summary
                    </button>
                </div>
            </div>

            {/* ══ KPI CARDS ══ */}
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

            {/* ══ FILTER BAR ══ */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
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
            </div>

            {/* ══ TAB BAR ══ */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20 }}>
                {TABS.map(t => (
                    <button key={t.key} onClick={() => { setActiveTab(t.key); setDrawerRow(null); }} style={{
                        padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        background: 'transparent', border: 'none',
                        color: activeTab === t.key ? C.blue : C.muted,
                        borderBottom: activeTab === t.key ? `2px solid ${C.blue}` : '2px solid transparent',
                        transition: 'all 0.15s',
                    }}>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ══ TAB CONTENT ══ */}
            <div style={{ display: 'flex', gap: 0 }}>
                <div style={{ flex: 1, minWidth: 0, transition: 'all 0.25s' }}>

                    {/* ── TAB 1: Price Intelligence ── */}
                    {activeTab === 'price' && (
                        <div>
                            <SummaryCards items={[
                                { label: 'Lowest Priced Vendors', value: priceRows.filter(r => r.spread < 2).length, color: C.green },
                                { label: 'Above Market', value: priceRows.filter(r => r.spread > 3).length, color: C.red },
                                { label: 'Competitive Match', value: priceRows.filter(r => r.spread >= 2 && r.spread <= 3).length, color: C.blue },
                                { label: 'Aggressive Pricing Opps', value: priceRows.filter(r => r.volatility === 'Low').length, color: C.amber },
                            ]} />
                            <TableCard>
                                <thead>
                                    <tr><th style={thS}>Comparable Group</th><th style={thS}>Category</th><th style={thS}>Lowest</th><th style={thS}>Median</th><th style={thS}>Highest</th><th style={thS}>Spread</th><th style={thS}>Vendors</th><th style={thS}>Volatility</th><th style={thS}>Action</th></tr>
                                </thead>
                                <tbody>
                                    {priceRows.map(r => (
                                        <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                            <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.group}</td>
                                            <td style={tdS}><Badge text={r.category} /></td>
                                            <td style={{ ...tdS, color: C.green, fontWeight: 700 }}>${r.lowest.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.fg }}>${r.median.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.red, fontWeight: 600 }}>${r.highest.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.amber, fontWeight: 700 }}>${r.spread.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.blue }}>{r.vendors}</td>
                                            <td style={tdS}><RiskBadge level={r.volatility} /></td>
                                            <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                        </tr>
                                    ))}
                                    {priceRows.length === 0 && <EmptyRow cols={9} />}
                                </tbody>
                            </TableCard>
                        </div>
                    )}

                    {/* ── TAB 2: Savings Opportunities ── */}
                    {activeTab === 'savings' && (
                        <div>
                            <SummaryCards items={[
                                { label: 'Total Est. Monthly Savings', value: `$${savingsRows.reduce((a, r) => a + r.monthlySavings, 0).toFixed(0)}`, color: C.green },
                                { label: 'Restaurants w/ Alerts', value: new Set(savingsRows.map(r => r.restaurant)).size, color: C.blue },
                                { label: 'Biggest Per-Item Savings', value: `$${Math.max(...savingsRows.map(r => r.savings), 0).toFixed(2)}`, color: C.amber },
                                { label: 'Biggest Restaurant Savings', value: `$${Math.max(...savingsRows.map(r => r.monthlySavings), 0).toFixed(0)}/mo`, color: C.purple },
                            ]} />
                            <TableCard>
                                <thead>
                                    <tr><th style={thS}>Restaurant</th><th style={thS}>Item</th><th style={thS}>Current Price</th><th style={thS}>Best Price</th><th style={thS}>Savings/Unit</th><th style={thS}>Monthly Usage</th><th style={thS}>Monthly Savings</th><th style={thS}>Confidence</th><th style={thS}>Action</th></tr>
                                </thead>
                                <tbody>
                                    {savingsRows.map(r => (
                                        <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                            <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.restaurant}</td>
                                            <td style={{ ...tdS, color: C.fg }}>{r.item}</td>
                                            <td style={{ ...tdS, color: C.red, fontWeight: 600 }}>${r.currentPrice.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.green, fontWeight: 700 }}>${r.bestPrice.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.amber, fontWeight: 700 }}>${r.savings.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.muted }}>{r.monthlyUsage}</td>
                                            <td style={tdS}><span style={{ background: 'rgba(52,211,153,0.1)', color: C.green, padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>${r.monthlySavings.toFixed(2)}</span></td>
                                            <td style={tdS}><ConfBadge level={r.confidence} /></td>
                                            <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                        </tr>
                                    ))}
                                    {savingsRows.length === 0 && <EmptyRow cols={9} />}
                                </tbody>
                            </TableCard>
                        </div>
                    )}

                    {/* ── TAB 3: Bundle Intelligence ── */}
                    {activeTab === 'bundle' && (
                        <div>
                            <SummaryCards items={[
                                { label: 'Bundle Gap Alerts', value: bundleRows.filter(r => r.risk !== 'Low').length, color: C.red },
                                { label: 'Highest Missed Pair', value: bundleRows.reduce((best, r) => r.weeklyMisses > (best?.weeklyMisses || 0) ? r : best, bundleRows[0])?.group || '—', color: C.amber, small: true },
                                { label: 'Most Reliable Pair', value: bundleRows.reduce((best, r) => r.risk === 'Low' ? r : best, { group: '—' })?.group || '—', color: C.green, small: true },
                                { label: 'Conversion Opportunity', value: `${bundleRows.reduce((a, r) => a + r.weeklyMisses, 0)}/week`, color: C.purple },
                            ]} />
                            <TableCard>
                                <thead>
                                    <tr><th style={thS}>Group</th><th style={thS}>Primary Item</th><th style={thS}>Companion</th><th style={thS}>Expected Ratio</th><th style={thS}>Actual Ratio</th><th style={thS}>Risk</th><th style={thS}>Weekly Misses</th><th style={thS}>Recommendation</th><th style={thS}>Action</th></tr>
                                </thead>
                                <tbody>
                                    {bundleRows.map(r => (
                                        <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                            <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.group}</td>
                                            <td style={{ ...tdS, color: C.fg }}>{r.primary}</td>
                                            <td style={{ ...tdS, color: C.fg }}>{r.companion}</td>
                                            <td style={{ ...tdS, color: C.blue }}>{r.expectedRatio}</td>
                                            <td style={{ ...tdS, color: riskColor[r.risk], fontWeight: 600 }}>{r.actualRatio}</td>
                                            <td style={tdS}><RiskBadge level={r.risk} /></td>
                                            <td style={{ ...tdS, color: C.amber, fontWeight: 700 }}>{r.weeklyMisses}</td>
                                            <td style={{ ...tdS, color: C.muted, fontSize: 12 }}>{r.recommendation}</td>
                                            <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                        </tr>
                                    ))}
                                    {bundleRows.length === 0 && <EmptyRow cols={9} />}
                                </tbody>
                            </TableCard>
                        </div>
                    )}

                    {/* ── TAB 4: Substitution Intelligence ── */}
                    {activeTab === 'substitution' && (
                        <div>
                            <SummaryCards items={[
                                { label: 'Exact Substitutes', value: subRows.filter(r => r.matchType === 'Exact Comparable').length, color: C.green },
                                { label: 'Pack-Normalized', value: subRows.filter(r => r.matchType === 'Pack-Normalized').length, color: C.blue },
                                { label: 'High Confidence', value: subRows.filter(r => r.confidence === 'High').length, color: C.green },
                                { label: 'Caution / Near', value: subRows.filter(r => r.matchType === 'Near Comparable').length, color: C.amber },
                            ]} />
                            <TableCard>
                                <thead>
                                    <tr><th style={thS}>Item</th><th style={thS}>Best Substitute</th><th style={thS}>Match Type</th><th style={thS}>Price Diff</th><th style={thS}>Confidence</th><th style={thS}>Notes</th><th style={thS}>Action</th></tr>
                                </thead>
                                <tbody>
                                    {subRows.map(r => (
                                        <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                            <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.item}</td>
                                            <td style={{ ...tdS, color: C.fg }}>{r.bestSub}</td>
                                            <td style={tdS}><span style={{ background: `${matchTypeColor[r.matchType]}18`, color: matchTypeColor[r.matchType], padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{r.matchType}</span></td>
                                            <td style={{ ...tdS, color: r.priceDiff.startsWith('-') ? C.green : C.amber, fontWeight: 700 }}>{r.priceDiff}</td>
                                            <td style={tdS}><ConfBadge level={r.confidence} /></td>
                                            <td style={{ ...tdS, color: C.muted, fontSize: 12, maxWidth: 200 }}>{r.notes}</td>
                                            <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                        </tr>
                                    ))}
                                    {subRows.length === 0 && <EmptyRow cols={7} />}
                                </tbody>
                            </TableCard>
                        </div>
                    )}

                    {/* ── TAB 5: Market Watch ── */}
                    {activeTab === 'watch' && (
                        <div>
                            <SummaryCards items={[
                                { label: 'Rising Groups', value: watchRows.filter(r => r.trend.startsWith('+')).length, color: C.red },
                                { label: 'Falling Groups', value: watchRows.filter(r => r.trend.startsWith('-')).length, color: C.green },
                                { label: 'High Volatility', value: watchRows.filter(r => r.volatility === 'High').length, color: C.amber },
                                { label: 'New Competitive Entries', value: watchRows.filter(r => r.newEntry).length, color: C.blue },
                            ]} />
                            <TableCard>
                                <thead>
                                    <tr><th style={thS}>Comparable Group</th><th style={thS}>4-Week Trend</th><th style={thS}>Current Lowest</th><th style={thS}>Current Median</th><th style={thS}>Volatility</th><th style={thS}>New Entry</th><th style={thS}>Signal</th><th style={thS}>Action</th></tr>
                                </thead>
                                <tbody>
                                    {watchRows.map(r => (
                                        <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                            <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.group}</td>
                                            <td style={{ ...tdS, fontWeight: 700, color: r.trend.startsWith('+') ? C.green : C.red, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                {r.trend.startsWith('+') ? <FiTrendingUp size={14} /> : <FiTrendingDown size={14} />} {r.trend}
                                            </td>
                                            <td style={{ ...tdS, color: C.green, fontWeight: 700 }}>${r.lowest.toFixed(2)}</td>
                                            <td style={{ ...tdS, color: C.fg }}>${r.median.toFixed(2)}</td>
                                            <td style={tdS}><RiskBadge level={r.volatility} /></td>
                                            <td style={tdS}>{r.newEntry ? <span style={{ color: C.green, fontWeight: 700 }}>✓ Yes</span> : <span style={{ color: C.muted }}>No</span>}</td>
                                            <td style={tdS}><span style={{ color: signalColor[r.signal], fontWeight: 700, fontSize: 12 }}>● {r.signal}</span></td>
                                            <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                        </tr>
                                    ))}
                                    {watchRows.length === 0 && <EmptyRow cols={8} />}
                                </tbody>
                            </TableCard>
                        </div>
                    )}

                    {/* ── TAB 6: Vendor Scores ── */}
                    {activeTab === 'scores' && (
                        <div>
                            <SummaryCards items={[
                                { label: 'Excellent (90+)', value: scoreRows.filter(r => r.finalScore >= 90).length, color: C.green },
                                { label: 'Strong (75–89)', value: scoreRows.filter(r => r.finalScore >= 75 && r.finalScore < 90).length, color: C.blue },
                                { label: 'Competitive (60–74)', value: scoreRows.filter(r => r.finalScore >= 60 && r.finalScore < 75).length, color: C.amber },
                                { label: 'At Risk (<60)', value: scoreRows.filter(r => r.finalScore < 60).length, color: C.red },
                            ]} />
                            <TableCard>
                                <thead>
                                    <tr><th style={thS}>Vendor</th><th style={thS}>Item</th><th style={thS}>Score</th><th style={thS}>Label</th><th style={thS}>Price</th><th style={thS}>Reliability</th><th style={thS}>Demand</th><th style={thS}>Avail</th><th style={thS}>Badges</th><th style={thS}>Action</th></tr>
                                </thead>
                                <tbody>
                                    {scoreRows.map(r => {
                                        const sl = scoreLabel(r.finalScore);
                                        return (
                                            <tr key={`${r.vendorId}_${r.itemName}`} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                                <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.vendorName}</td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.itemName}</td>
                                                <td style={{ ...tdS, fontWeight: 800, color: sl.color, fontSize: 16 }}>{r.finalScore}</td>
                                                <td style={tdS}><span style={{ background: `${sl.color}22`, color: sl.color, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{sl.text}</span></td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.factorBreakdown.price}/40</td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.factorBreakdown.reliability}/25</td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.factorBreakdown.demandMatch}/15</td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.factorBreakdown.availability}/10</td>
                                                <td style={tdS}>
                                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                        {(r.badges || []).map((b, bi) => (
                                                            <span key={bi} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${badgeColor[b] || C.muted}22`, color: badgeColor[b] || C.muted, whiteSpace: 'nowrap' }}>{b}</span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                            </tr>
                                        );
                                    })}
                                    {scoreRows.length === 0 && <EmptyRow cols={10} />}
                                </tbody>
                            </TableCard>
                        </div>
                    )}
                </div>

                {/* ══ DETAIL DRAWER ══ */}
                {drawerRow && <DetailDrawer tab={activeTab} row={drawerRow} onClose={() => setDrawerRow(null)} />}
            </div>
        </div>
    );
}

// ── Sub-Components ────────────────────────────────────────────────────────────

function SummaryCards({ items }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 12, marginBottom: 18 }}>
            {items.map(k => (
                <div key={k.label} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 10, padding: '14px 16px',
                }}>
                    <div style={{ fontSize: k.small ? 13 : 22, fontWeight: 700, color: k.color, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.value}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{k.label}</div>
                </div>
            ))}
        </div>
    );
}

function TableCard({ children }) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
        </div>
    );
}

function Badge({ text }) {
    return <span style={{ background: 'rgba(148,163,184,0.1)', color: C.muted, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{text}</span>;
}

function RiskBadge({ level }) {
    const c = riskColor[level] || C.muted;
    return <span style={{ background: `${c}18`, color: c, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{level}</span>;
}

function ConfBadge({ level }) {
    const c = confColor[level] || C.muted;
    return <span style={{ background: `${c}18`, color: c, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{level}</span>;
}

function ActionBtn({ onClick }) {
    return (
        <button onClick={e => { e.stopPropagation(); onClick(); }} style={{
            background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
            color: C.blue, padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
            <FiEye size={12} /> View
        </button>
    );
}

function EmptyRow({ cols }) {
    return <tr><td colSpan={cols} style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>No data matches current filters</td></tr>;
}

function DetailDrawer({ tab, row, onClose }) {
    const content = buildDrawerContent(tab, row);
    if (!content) return null;

    return (
        <div style={{
            width: 380, minWidth: 380, borderLeft: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)',
            marginLeft: 0, padding: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 200px)',
            borderRadius: '0 12px 12px 0',
        }}>
            {/* Header */}
            <div style={{
                padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                position: 'sticky', top: 0, background: 'rgba(15,23,42,0.98)', zIndex: 2,
            }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>{content.title}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{content.subtitle}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}><FiX size={18} /></button>
            </div>

            {/* Sections */}
            {content.sections.map((sec, si) => (
                <div key={si} style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>{sec.heading}</div>
                    {sec.rows.map(([label, value, color], ri) => (
                        <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                            <span style={{ color: C.muted }}>{label}</span>
                            <span style={{ fontWeight: 600, color: color || C.fg, maxWidth: 180, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
                        </div>
                    ))}
                </div>
            ))}

            {/* Actions */}
            {content.actions && content.actions.length > 0 && (
                <div style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Available Actions</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {content.actions.map((a, i) => (
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
            )}
        </div>
    );
}
