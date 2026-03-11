/**
 * MarketplaceIntelligencePage.js
 *
 * Admin-only intelligence hub for vendor pricing, restaurant savings,
 * bundle gaps, substitution opportunities, and market movement.
 *
 * Tabs 1–4 are powered by live Firestore data.
 * Tabs 5–6 show "Coming Soon" placeholders (require new collections).
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
    FiRefreshCw, FiDownload, FiSearch, FiX, FiChevronRight,
    FiTrendingUp, FiTrendingDown, FiAlertTriangle, FiCheckCircle,
    FiShield, FiPackage, FiDollarSign, FiActivity, FiLayers, FiEye, FiAward, FiClock,
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { fetchOrderHistory } from '../Forecast/forecastHelpers';
import { COMPATIBILITY_MAP } from '../Vendors/marketplaceIntelligence';
import { calculateCompetitivenessScore, scoreLabel, assignBadges } from '../Vendors/vendorCompetitivenessEngine';

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
    { key: 'price',        label: '💰 Price Intelligence' },
    { key: 'savings',      label: '📉 Savings Opportunities' },
    { key: 'bundle',       label: '🔗 Bundle Intelligence' },
    { key: 'scores',       label: '🏆 Vendor Scores' },
    { key: 'substitution', label: '🔄 Substitution Intelligence' },
    { key: 'watch',        label: '📈 Market Watch' },
];

const CATEGORIES = ['All', 'Produce', 'Packaging', 'Cleaning Supplies'];

// ── Style Tokens ──────────────────────────────────────────────────────────────
const C = {
    green: '#34d399', red: '#f87171', amber: '#fbbf24', blue: '#38bdf8',
    purple: '#a78bfa', cyan: '#22d3ee', muted: '#94a3b8', fg: '#f8fafc',
};

const riskColor = { Low: C.green, Medium: C.amber, High: C.red, Critical: C.red };
const confColor = { High: C.green, Medium: C.amber, Low: C.red };
const badgeColor = { 'Best Overall Choice': C.green, 'Lowest Price': C.blue, 'Most Reliable': C.purple };

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

// ── Detail Drawer Items Builder ───────────────────────────────────────────────
function buildDrawerContent(tab, row) {
    if (!row) return null;
    switch (tab) {
        case 'price':
            return {
                title: row.itemName, subtitle: row.category || 'Produce',
                sections: [
                    { heading: '📊 Price Range', rows: [
                        ['Lowest Active Price', `$${row.lowest.toFixed(2)}`, C.green],
                        ['Median Active Price', `$${row.median.toFixed(2)}`, C.fg],
                        ['Highest Active Price', `$${row.highest.toFixed(2)}`, C.red],
                        ['Price Spread', `$${row.spread.toFixed(2)}`, C.amber],
                    ]},
                    { heading: '📈 Market Context', rows: [
                        ['Active Vendors', row.vendors, C.blue],
                        ...(row.vendorNames || []).map(v => [v.name, `$${v.price.toFixed(2)}`, v.price === row.lowest ? C.green : v.price === row.highest ? C.red : C.fg]),
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
                        ['Most Recent Price Paid', `$${row.currentPrice.toFixed(2)}`, C.red],
                        ['Best Available Vendor', row.bestVendor, C.fg],
                        ['Best Available Price', `$${row.bestPrice.toFixed(2)}`, C.green],
                        ['Savings Per Unit', `$${row.savings.toFixed(2)}`, C.amber],
                    ]},
                    { heading: '📦 Usage & Impact', rows: [
                        ['Recent Order Qty', row.recentQty, C.blue],
                        ['Est. Monthly Savings', `$${row.monthlySavings.toFixed(2)}`, C.green],
                        ['Est. Annual Savings', `$${(row.monthlySavings * 12).toFixed(2)}`, C.green],
                    ]},
                ],
                actions: ['Queue Savings Alert', 'Recommend in Suggested Orders', 'View Comparison'],
            };
        case 'bundle':
            return {
                title: `${row.primary} + ${row.companion}`, subtitle: 'Compatibility Group',
                sections: [
                    { heading: '🔗 Pair Info', rows: [
                        ['Primary Item', row.primary, C.fg],
                        ['Companion Item', row.companion, C.fg],
                        ['Expected Ratio', '1:1', C.blue],
                        ['Co-Purchase Frequency', `${row.pairFrequency}%`, riskColor[row.risk]],
                    ]},
                    { heading: '⚠️ Risk Assessment', rows: [
                        ['Missing Pair Risk', row.risk, riskColor[row.risk]],
                        ['Orders With Primary', row.primaryCount, C.fg],
                        ['Orders With Both', row.bothCount, C.fg],
                        ['Recommendation', row.recommendation, C.fg],
                    ]},
                ],
                actions: ['Queue Bundle Alert', 'Review Compatibility Mapping'],
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
// DATA LOADING
// ══════════════════════════════════════════════════════════════════════════════

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
                    unit: data.unit || '',
                    category: data.category || 'Produce',
                    packQuantity: data.packQuantity || 1,
                    itemSize: data.itemSize || '',
                    vendorItemNames,
                });
            });
        } catch (e) {
            console.warn('Failed to load items for vendor', v.id);
        }
    }
    return allItems;
}

function computePriceIntelligence(allItems) {
    // Group items by normalized name
    const groups = {};
    allItems.forEach(item => {
        const key = item.itemName.toLowerCase();
        if (!groups[key]) groups[key] = { itemName: item.itemName, category: item.category, vendorPrices: [] };
        if (item.price > 0) {
            groups[key].vendorPrices.push({ name: item.vendorName, price: item.price, vendorId: item.vendorId });
        }
        // Keep the first non-empty category we find
        if (item.category && item.category !== 'Produce') groups[key].category = item.category;
    });

    // Only show items offered by 2+ vendors (so we can compare)
    return Object.values(groups)
        .filter(g => g.vendorPrices.length >= 2)
        .map((g, idx) => {
            const prices = g.vendorPrices.map(v => v.price);
            const lowest = Math.min(...prices);
            const highest = Math.max(...prices);
            const med = getMedian(prices);
            return {
                id: idx + 1,
                itemName: g.itemName,
                category: g.category,
                lowest,
                highest,
                median: med,
                spread: parseFloat((highest - lowest).toFixed(2)),
                vendors: g.vendorPrices.length,
                vendorNames: g.vendorPrices.sort((a, b) => a.price - b.price),
            };
        })
        .sort((a, b) => b.spread - a.spread);
}

function computeSavingsOpportunities(allItems, orderRecords) {
    // Build a price lookup: itemName (lowercase) → { lowestPrice, bestVendor, allPrices }
    const priceLookup = {};
    allItems.forEach(item => {
        const key = item.itemName.toLowerCase();
        if (item.price <= 0) return;
        if (!priceLookup[key]) priceLookup[key] = { prices: [], bestPrice: Infinity, bestVendor: '' };
        priceLookup[key].prices.push({ vendor: item.vendorName, price: item.price });
        if (item.price < priceLookup[key].bestPrice) {
            priceLookup[key].bestPrice = item.price;
            priceLookup[key].bestVendor = item.vendorName;
        }
    });

    // Group recent orders by restaurant + item, get most recent price paid
    const orderMap = {}; // `${restaurantId}__${itemName}` → { vendor, orderPrice, qty }
    orderRecords.forEach(rec => {
        const key = `${rec.restaurantId}__${rec.itemName.toLowerCase()}`;
        // We keep the latest order (orderRecords come sorted desc by date)
        if (!orderMap[key]) {
            orderMap[key] = {
                restaurantId: rec.restaurantId,
                restaurant: rec.restaurantId,
                item: rec.itemName,
                vendor: rec.vendor,
                qty: rec.qty,
            };
        }
    });

    // Find savings: where the vendor paid isn't the cheapest
    const results = [];
    let idCounter = 1;
    Object.values(orderMap).forEach(order => {
        const key = order.item.toLowerCase();
        const lookup = priceLookup[key];
        if (!lookup || lookup.prices.length < 2) return;

        // Find the price the restaurant's current vendor charges
        const vendorPriceEntry = lookup.prices.find(p => p.vendor.toLowerCase() === (order.vendor || '').toLowerCase());
        if (!vendorPriceEntry) return;

        const currentPrice = vendorPriceEntry.price;
        const bestPrice = lookup.bestPrice;
        const savings = currentPrice - bestPrice;

        if (savings > 0.01 && lookup.bestVendor.toLowerCase() !== (order.vendor || '').toLowerCase()) {
            results.push({
                id: idCounter++,
                restaurant: order.restaurant || 'Unknown',
                item: order.item,
                vendor: order.vendor,
                currentPrice,
                bestPrice,
                bestVendor: lookup.bestVendor,
                savings: parseFloat(savings.toFixed(2)),
                recentQty: order.qty,
                // Estimate 4 orders/month
                monthlySavings: parseFloat((savings * (order.qty || 1) * 4).toFixed(2)),
            });
        }
    });

    return results.sort((a, b) => b.monthlySavings - a.monthlySavings);
}

function computeBundleIntelligence(orderRecords) {
    // Only look at container/lid pairs from the COMPATIBILITY_MAP
    // Group orders by restaurant + date to find co-purchase patterns
    const orderGroups = {}; // `${restaurantId}__${date}` → Set of item names
    orderRecords.forEach(rec => {
        const key = `${rec.restaurantId}__${rec.date}`;
        if (!orderGroups[key]) orderGroups[key] = new Set();
        orderGroups[key].add(rec.itemName);
    });

    // For each compatibility pair, count how often they appear together
    const pairStats = {}; // `primary__companion` → { primaryCount, bothCount }
    const processed = new Set(); // avoid duplicate pairs

    Object.keys(COMPATIBILITY_MAP).forEach(primary => {
        const companion = COMPATIBILITY_MAP[primary].match;
        const pairKey = [primary, companion].sort().join('__');
        if (processed.has(pairKey)) return;
        processed.add(pairKey);

        let primaryCount = 0;
        let bothCount = 0;

        Object.values(orderGroups).forEach(itemSet => {
            // Check if primary appears (case-insensitive)
            const hasPrimary = [...itemSet].some(n => n.toLowerCase() === primary.toLowerCase());
            const hasCompanion = [...itemSet].some(n => n.toLowerCase() === companion.toLowerCase());

            if (hasPrimary) {
                primaryCount++;
                if (hasCompanion) bothCount++;
            }
        });

        if (primaryCount > 0) {
            const freq = Math.round((bothCount / primaryCount) * 100);
            let risk = 'Low';
            if (freq < 70) risk = 'High';
            else if (freq < 85) risk = 'Medium';

            let recommendation = 'Monitor only';
            if (risk === 'High') recommendation = 'Auto-prompt for companion item';
            else if (risk === 'Medium') recommendation = 'Suggest companion add-on';

            pairStats[pairKey] = {
                id: Object.keys(pairStats).length + 1,
                primary,
                companion,
                primaryCount,
                bothCount,
                pairFrequency: freq,
                risk,
                recommendation,
            };
        }
    });

    return Object.values(pairStats).sort((a, b) => a.pairFrequency - b.pairFrequency);
}

async function loadVendorScores() {
    try {
        const snap = await getDocs(collection(db, 'vendorScores'));
        if (snap.empty) return null; // No pre-computed scores
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.warn('[Intelligence] No vendorScores collection yet:', err.message);
        return null;
    }
}

function computeVendorScoresLive(allItems) {
    // Group items by normalized name to get price context
    const groups = {};
    allItems.forEach(item => {
        const key = item.itemName.toLowerCase();
        if (!groups[key]) groups[key] = { itemName: item.itemName, category: item.category, vendors: [] };
        if (item.price > 0) {
            groups[key].vendors.push(item);
        }
    });

    const allScores = [];
    Object.values(groups).forEach(g => {
        if (g.vendors.length < 1) return;
        const prices = g.vendors.map(v => v.price);
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        const sorted = [...prices].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

        g.vendors.forEach(v => {
            const record = calculateCompetitivenessScore({
                vendorId: v.vendorId,
                vendorName: v.vendorName,
                itemId: v.itemId,
                itemName: g.itemName,
                comparableGroup: g.itemName.toLowerCase().replace(/\s+/g, '_'),
                normalizedPrice: v.price,
                lowestPrice: lowest,
                medianPrice: med,
                highestPrice: highest,
                vendorItemNames: v.vendorItemNames || [],
            });
            record.category = g.category;
            allScores.push(record);
        });
    });

    // Assign badges per group
    const grouped = {};
    allScores.forEach(s => {
        (grouped[s.comparableGroup] = grouped[s.comparableGroup] || []).push(s);
    });
    Object.values(grouped).forEach(g => { if (g.length > 1) assignBadges(g); });

    return allScores;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function MarketplaceIntelligencePage() {
    const [activeTab, setActiveTab] = useState('price');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [search, setSearch] = useState('');
    const [drawerRow, setDrawerRow] = useState(null);
    const [loading, setLoading] = useState(true);

    // Data state
    const [priceData, setPriceData] = useState([]);
    const [savingsData, setSavingsData] = useState([]);
    const [bundleData, setBundleData] = useState([]);
    const [scoreData, setScoreData] = useState([]);

    // ── Data Loader ───────────────────────────────────────────────────────────
    const loadData = async () => {
        setLoading(true);
        try {
            // 1. Load all vendor items from Firestore
            const allItems = await loadAllVendorItems();
            console.log(`[Intelligence] Loaded ${allItems.length} vendor items from Firestore`);

            // 2. Load order history for savings + bundles
            const orderRecords = await fetchOrderHistory(12);
            console.log(`[Intelligence] Loaded ${orderRecords.length} order records from Firestore`);

            // 3. Compute Price Intelligence
            const priceIntel = computePriceIntelligence(allItems);
            setPriceData(priceIntel);

            // 4. Compute Savings Opportunities
            const savings = computeSavingsOpportunities(allItems, orderRecords);
            setSavingsData(savings);

            // 5. Compute Bundle Intelligence
            const bundles = computeBundleIntelligence(orderRecords);
            setBundleData(bundles);

            // 6. Load or compute Vendor Scores
            const precomputed = await loadVendorScores();
            if (precomputed && precomputed.length > 0) {
                console.log(`[Intelligence] Loaded ${precomputed.length} pre-computed vendor scores`);
                setScoreData(precomputed);
            } else {
                console.log('[Intelligence] No vendorScores collection — computing live from catalog');
                const scores = computeVendorScoresLive(allItems);
                setScoreData(scores);
            }
        } catch (err) {
            console.error('[Intelligence] Failed to load data:', err);
            toast.error('Failed to load intelligence data');
        }
        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    // ── Filter logic ──────────────────────────────────────────────────────────
    const filterRows = (rows) => rows.filter(r => {
        const cat = selectedCategory;
        if (cat !== 'All') {
            const rowCat = r.category || '';
            if (rowCat && rowCat !== cat) return false;
        }
        if (search) {
            const q = search.toLowerCase();
            const haystack = Object.values(r).map(v => typeof v === 'string' ? v : '').join(' ').toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    });

    const priceRows = useMemo(() => filterRows(priceData), [selectedCategory, search, priceData]);
    const savingsRows = useMemo(() => filterRows(savingsData), [selectedCategory, search, savingsData]);
    const bundleRows = useMemo(() => bundleData, [bundleData]); // Bundles don't have category
    const scoreRows = useMemo(() => {
        return scoreData.filter(r => {
            if (selectedCategory !== 'All' && r.category && r.category !== selectedCategory) return false;
            if (search) {
                const q = search.toLowerCase();
                const h = `${r.vendorName} ${r.itemName} ${r.comparableGroup}`.toLowerCase();
                if (!h.includes(q)) return false;
            }
            return true;
        }).sort((a, b) => b.finalScore - a.finalScore);
    }, [selectedCategory, search, scoreData]);

    // ── KPI Counts ────────────────────────────────────────────────────────────
    const kpis = [
        { label: 'Price Comparisons', value: priceData.length, icon: <FiActivity />, color: C.blue },
        { label: 'Savings Opportunities', value: savingsData.length, icon: <FiDollarSign />, color: C.green },
        { label: 'High Spread Items', value: priceData.filter(r => r.spread >= 4).length, icon: <FiAlertTriangle />, color: C.amber },
        { label: 'Bundle Alerts', value: bundleData.filter(r => r.risk !== 'Low').length, icon: <FiPackage />, color: C.purple },
        { label: 'Vendors Scored', value: new Set(scoreData.map(r => r.vendorName)).size, icon: <FiAward />, color: C.cyan },
        { label: 'At Risk (<60)', value: scoreData.filter(r => r.finalScore < 60).length, icon: <FiShield />, color: C.red },
    ];

    const handleRefresh = () => { loadData(); toast.info('Refreshing intelligence data…'); };
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
                        Monitor pricing competitiveness, savings opportunities, compatibility gaps, and vendor scores across the marketplace.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <FiSearch size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                        <input
                            placeholder="Search item or vendor…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{
                                padding: '8px 12px 8px 32px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                                background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, width: 220, outline: 'none',
                            }}
                        />
                    </div>
                    <button onClick={handleRefresh} disabled={loading} style={{
                        padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: C.fg, fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <FiRefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
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
                        <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{loading ? '…' : k.value}</div>
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

            {/* ══ LOADING ══ */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 60, color: C.muted, fontSize: 14 }}>
                    <FiRefreshCw size={24} className="spin" style={{ marginBottom: 12 }} /><br />
                    Loading intelligence data from Firestore…
                </div>
            )}

            {/* ══ TAB CONTENT ══ */}
            {!loading && (
                <div style={{ display: 'flex', gap: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, transition: 'all 0.25s' }}>

                        {/* ── TAB 1: Price Intelligence ── */}
                        {activeTab === 'price' && (
                            <div>
                                <SummaryCards items={[
                                    { label: 'Items Compared', value: priceRows.length, color: C.blue },
                                    { label: 'High Spread (>$3)', value: priceRows.filter(r => r.spread > 3).length, color: C.red },
                                    { label: 'Competitive (<$2)', value: priceRows.filter(r => r.spread < 2).length, color: C.green },
                                    { label: 'Avg Spread', value: priceRows.length > 0 ? `$${(priceRows.reduce((a, r) => a + r.spread, 0) / priceRows.length).toFixed(2)}` : '$0', color: C.amber },
                                ]} />
                                <TableCard>
                                    <thead>
                                        <tr><th style={thS}>Item</th><th style={thS}>Category</th><th style={thS}>Lowest</th><th style={thS}>Median</th><th style={thS}>Highest</th><th style={thS}>Spread</th><th style={thS}>Vendors</th><th style={thS}>Action</th></tr>
                                    </thead>
                                    <tbody>
                                        {priceRows.map(r => (
                                            <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                                <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.itemName}</td>
                                                <td style={tdS}><Badge text={r.category} /></td>
                                                <td style={{ ...tdS, color: C.green, fontWeight: 700 }}>${r.lowest.toFixed(2)}</td>
                                                <td style={{ ...tdS, color: C.fg }}>${r.median.toFixed(2)}</td>
                                                <td style={{ ...tdS, color: C.red, fontWeight: 600 }}>${r.highest.toFixed(2)}</td>
                                                <td style={{ ...tdS, color: C.amber, fontWeight: 700 }}>${r.spread.toFixed(2)}</td>
                                                <td style={{ ...tdS, color: C.blue }}>{r.vendors}</td>
                                                <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                            </tr>
                                        ))}
                                        {priceRows.length === 0 && <EmptyRow cols={8} />}
                                    </tbody>
                                </TableCard>
                            </div>
                        )}

                        {/* ── TAB 2: Savings Opportunities ── */}
                        {activeTab === 'savings' && (
                            <div>
                                <SummaryCards items={[
                                    { label: 'Total Est. Monthly Savings', value: `$${savingsRows.reduce((a, r) => a + r.monthlySavings, 0).toFixed(0)}`, color: C.green },
                                    { label: 'Restaurants w/ Savings', value: new Set(savingsRows.map(r => r.restaurant)).size, color: C.blue },
                                    { label: 'Biggest Per-Item Gap', value: savingsRows.length > 0 ? `$${Math.max(...savingsRows.map(r => r.savings)).toFixed(2)}` : '$0', color: C.amber },
                                    { label: 'Items With Savings', value: savingsRows.length, color: C.purple },
                                ]} />
                                <TableCard>
                                    <thead>
                                        <tr><th style={thS}>Restaurant</th><th style={thS}>Item</th><th style={thS}>Current Price</th><th style={thS}>Best Price</th><th style={thS}>Savings/Unit</th><th style={thS}>Best Vendor</th><th style={thS}>Monthly Savings</th><th style={thS}>Action</th></tr>
                                    </thead>
                                    <tbody>
                                        {savingsRows.map(r => (
                                            <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                                <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.restaurant}</td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.item}</td>
                                                <td style={{ ...tdS, color: C.red, fontWeight: 600 }}>${r.currentPrice.toFixed(2)}</td>
                                                <td style={{ ...tdS, color: C.green, fontWeight: 700 }}>${r.bestPrice.toFixed(2)}</td>
                                                <td style={{ ...tdS, color: C.amber, fontWeight: 700 }}>${r.savings.toFixed(2)}</td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.bestVendor}</td>
                                                <td style={tdS}><span style={{ background: 'rgba(52,211,153,0.1)', color: C.green, padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>${r.monthlySavings.toFixed(2)}</span></td>
                                                <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                            </tr>
                                        ))}
                                        {savingsRows.length === 0 && <EmptyRow cols={8} />}
                                    </tbody>
                                </TableCard>
                            </div>
                        )}

                        {/* ── TAB 3: Bundle Intelligence ── */}
                        {activeTab === 'bundle' && (
                            <div>
                                <SummaryCards items={[
                                    { label: 'Bundle Pairs Tracked', value: bundleRows.length, color: C.blue },
                                    { label: 'High Risk Gaps', value: bundleRows.filter(r => r.risk === 'High').length, color: C.red },
                                    { label: 'Medium Risk', value: bundleRows.filter(r => r.risk === 'Medium').length, color: C.amber },
                                    { label: 'Healthy Pairs', value: bundleRows.filter(r => r.risk === 'Low').length, color: C.green },
                                ]} />
                                <TableCard>
                                    <thead>
                                        <tr><th style={thS}>Primary Item</th><th style={thS}>Companion</th><th style={thS}>Primary Orders</th><th style={thS}>Paired Orders</th><th style={thS}>Pair Frequency</th><th style={thS}>Risk</th><th style={thS}>Recommendation</th><th style={thS}>Action</th></tr>
                                    </thead>
                                    <tbody>
                                        {bundleRows.map(r => (
                                            <tr key={r.id} style={{ cursor: 'pointer' }} {...trHover} onClick={() => setDrawerRow(r)}>
                                                <td style={{ ...tdS, fontWeight: 600, color: C.fg }}>{r.primary}</td>
                                                <td style={{ ...tdS, color: C.fg }}>{r.companion}</td>
                                                <td style={{ ...tdS, color: C.blue }}>{r.primaryCount}</td>
                                                <td style={{ ...tdS, color: C.blue }}>{r.bothCount}</td>
                                                <td style={{ ...tdS, color: riskColor[r.risk], fontWeight: 700 }}>{r.pairFrequency}%</td>
                                                <td style={tdS}><RiskBadge level={r.risk} /></td>
                                                <td style={{ ...tdS, color: C.muted, fontSize: 12 }}>{r.recommendation}</td>
                                                <td style={tdS}><ActionBtn onClick={() => setDrawerRow(r)} /></td>
                                            </tr>
                                        ))}
                                        {bundleRows.length === 0 && <EmptyRow cols={8} />}
                                    </tbody>
                                </TableCard>
                            </div>
                        )}

                        {/* ── TAB 4: Vendor Scores ── */}
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

                        {/* ── TAB 5: Substitution Intelligence (Coming Soon) ── */}
                        {activeTab === 'substitution' && <ComingSoonCard
                            title="Substitution Intelligence"
                            description="This module will activate once approved item substitution mappings are available."
                            detail="Requires a new itemSubstitutions collection with admin-approved mappings linking interchangeable items, match confidence levels, and price-normalized comparisons."
                            icon={<FiLayers size={32} />}
                        />}

                        {/* ── TAB 6: Market Watch (Coming Soon) ── */}
                        {activeTab === 'watch' && <ComingSoonCard
                            title="Market Price Watch"
                            description="Historical price tracking is required to enable market price trend analysis."
                            detail="Requires a new priceHistory collection that records vendor item prices over time to compute volatility, trend direction, and new vendor entry signals."
                            icon={<FiTrendingUp size={32} />}
                        />}

                    </div>

                    {/* ══ DETAIL DRAWER ══ */}
                    {drawerRow && <DetailDrawer tab={activeTab} row={drawerRow} onClose={() => setDrawerRow(null)} />}
                </div>
            )}
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

function ComingSoonCard({ title, description, detail, icon }) {
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '80px 40px', textAlign: 'center',
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 16, maxWidth: 560, margin: '20px auto',
        }}>
            <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: C.blue, marginBottom: 20,
            }}>
                {icon}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <FiClock size={16} style={{ color: C.amber }} />
                <span style={{ fontSize: 18, fontWeight: 700, color: C.fg }}>Feature Coming Soon</span>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: C.blue }}>{title}</h3>
            <p style={{ margin: '0 0 12px', color: C.muted, fontSize: 13, lineHeight: 1.6, maxWidth: 440 }}>{description}</p>
            <p style={{ margin: 0, color: 'rgba(148,163,184,0.6)', fontSize: 12, lineHeight: 1.5, maxWidth: 440, fontStyle: 'italic' }}>{detail}</p>
        </div>
    );
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
