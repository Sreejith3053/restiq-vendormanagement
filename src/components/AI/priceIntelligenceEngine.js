/**
 * priceIntelligenceEngine.js
 *
 * Analyzes vendor pricing across the marketplace.
 * Identifies cheapest vendors, abnormal price increases, and savings opportunities.
 *
 * Input:  vendors/{id}/items, marketplaceOrders (4 weeks)
 * Output: priceIntelligence[] array
 */
import { db } from '../../firebase';
import { collection, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeItem(name) {
    return (name || '').trim();
}

function weeksAgoTimestamp(weeks) {
    const d = new Date();
    d.setDate(d.getDate() - weeks * 7);
    return Timestamp.fromDate(d);
}

// ── Main computation ─────────────────────────────────────────────────────────

export async function computePriceIntelligence() {
    // 1. Load all vendor items
    const vendorsSnap = await getDocs(collection(db, 'vendors'));
    const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const allItems = []; // { vendorId, vendorName, itemName, price, category, catalogItemId }
    for (const v of vendors) {
        try {
            const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
            itemSnap.docs.forEach(d => {
                const data = d.data();
                const name = normalizeItem(data.name);
                if (!name) return;
                const price = parseFloat(data.vendorPrice) || parseFloat(data.price) || 0;
                if (price <= 0) return;
                allItems.push({
                    vendorId: v.id,
                    vendorName: v.name || 'Unknown',
                    itemName: name,
                    price,
                    category: data.category || 'Produce',
                    catalogItemId: data.catalogItemId || null,
                });
            });
        } catch (e) { /* skip vendor */ }
    }

    // 2. Load recent order history (4 weeks) for demand estimation
    let orderRecords = [];
    try {
        const cutoff = weeksAgoTimestamp(4);
        const ordersSnap = await getDocs(collection(db, 'marketplaceOrders'));
        ordersSnap.docs.forEach(d => {
            const data = d.data();
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null;
            if (!createdAt || createdAt < cutoff.toDate()) return;
            (data.items || []).forEach(item => {
                orderRecords.push({
                    itemName: normalizeItem(item.name),
                    qty: Number(item.qty) || 0,
                    vendor: item.vendor || '',
                    date: createdAt,
                    catalogItemId: item.catalogItemId || null,
                });
            });
        });
    } catch (e) {
        console.warn('[PriceIntel] Could not load order history:', e);
    }

    // 3. Group items by catalogItemId (preferred) or normalized name (fallback)
    const groups = {}; // key → { category, vendors: [{ vendorId, vendorName, price }] }
    allItems.forEach(item => {
        // Prefer catalogItemId for grouping — gives accurate cross-vendor matching
        const key = item.catalogItemId || item.itemName.toLowerCase();
        if (!groups[key]) {
            groups[key] = { itemName: item.itemName, category: item.category, vendors: [], catalogItemId: item.catalogItemId };
        }
        // Avoid duplicate vendor entries for same item
        const existing = groups[key].vendors.find(v => v.vendorId === item.vendorId);
        if (!existing) {
            groups[key].vendors.push({
                vendorId: item.vendorId,
                vendorName: item.vendorName,
                price: item.price,
            });
        }
    });

    // 4. Compute recent demand per item
    const demandMap = {};
    orderRecords.forEach(r => {
        const key = r.itemName.toLowerCase();
        demandMap[key] = (demandMap[key] || 0) + r.qty;
    });

    // 5. Build price intelligence records
    const priceIntelligence = [];
    const priceAlerts = [];

    Object.values(groups).forEach(g => {
        if (g.vendors.length === 0) return;

        const prices = g.vendors.map(v => v.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const spread = maxPrice - minPrice;

        const cheapestVendor = g.vendors.find(v => v.price === minPrice);
        const monthlyDemand = (demandMap[g.itemName.toLowerCase()] || 0);
        // Estimate monthly = 4-week demand (already 4 weeks of data)
        const savingsPerUnit = avgPrice - minPrice;
        const estimatedMonthlySavings = savingsPerUnit * monthlyDemand;

        // Check for price alerts — any vendor >10% above average
        const vendorAlerts = [];
        g.vendors.forEach(v => {
            if (avgPrice > 0 && v.price > avgPrice * 1.10) {
                vendorAlerts.push({
                    vendorName: v.vendorName,
                    vendorPrice: v.price,
                    avgPrice,
                    percentAbove: Math.round(((v.price - avgPrice) / avgPrice) * 100),
                });
            }
        });

        if (vendorAlerts.length > 0) {
            priceAlerts.push({
                itemName: g.itemName,
                category: g.category,
                alerts: vendorAlerts,
            });
        }

        priceIntelligence.push({
            itemName: g.itemName,
            category: g.category,
            vendorCount: g.vendors.length,
            vendors: g.vendors.sort((a, b) => a.price - b.price),
            cheapestVendor: cheapestVendor?.vendorName || '—',
            cheapestPrice: minPrice,
            highestPrice: maxPrice,
            avgPrice: Math.round(avgPrice * 100) / 100,
            spread: Math.round(spread * 100) / 100,
            savingsPerUnit: Math.round(savingsPerUnit * 100) / 100,
            monthlyDemand,
            estimatedMonthlySavings: Math.round(estimatedMonthlySavings * 100) / 100,
            hasAlert: vendorAlerts.length > 0,
            vendorAlerts,
        });
    });

    // Sort by savings opportunity descending
    priceIntelligence.sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);

    return {
        priceIntelligence,
        priceAlerts,
        summary: {
            totalItems: priceIntelligence.length,
            itemsWithAlerts: priceAlerts.length,
            totalMonthlySavings: priceIntelligence.reduce((s, r) => s + r.estimatedMonthlySavings, 0),
            avgSpread: priceIntelligence.length > 0
                ? Math.round((priceIntelligence.reduce((s, r) => s + r.spread, 0) / priceIntelligence.length) * 100) / 100
                : 0,
        },
    };
}
