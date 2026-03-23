/**
 * dispatchOptimizationEngine.js
 *
 * Identifies dispatch consolidation opportunities to reduce logistics complexity.
 * Groups dispatches by vendor + delivery day and suggests combining items.
 *
 * Input:  marketplaceOrders, vendors/{id}/items
 * Output: dispatchSuggestions[]
 */
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getActiveWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().slice(0, 10);
}

// ── Main computation ─────────────────────────────────────────────────────────

export async function computeDispatchOptimization() {
    const weekStart = getActiveWeekStart();

    // 1. Build catalog lookup (item → vendor)
    const catalogLookup = {}; // key (catalogItemId or itemName) → { vendor, category, price }
    try {
        const vendorsSnap = await getDocs(collection(db, 'vendors'));
        const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        for (const v of vendors) {
            try {
                const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
                itemSnap.docs.forEach(d => {
                    const data = d.data();
                    const name = (data.name || '').trim();
                    if (!name) return;
                    const entry = {
                        vendor: v.name || 'Unknown',
                        vendorId: v.id,
                        category: data.category || 'Produce',
                        price: parseFloat(data.vendorPrice) || parseFloat(data.price) || 0,
                        catalogItemId: data.catalogItemId || null,
                    };
                    // Store by both name and catalogItemId for flexible lookup
                    catalogLookup[name] = entry;
                    if (data.catalogItemId) catalogLookup[data.catalogItemId] = entry;
                });
            } catch (e) { /* skip */ }
        }
    } catch (e) {
        console.warn('[DispatchOpt] Could not load catalog:', e);
    }

    // 2. Load marketplace orders for current week
    let weekOrders = [];
    try {
        const soSnap = await getDocs(collection(db, 'marketplaceOrders'));
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        weekOrders = soSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(o => {
                const createdAt = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
                return createdAt && createdAt >= twoWeeksAgo;
            });
    } catch (e) {
        console.warn('[DispatchOpt] Could not load marketplace orders:', e);
    }

    // 2b. Build invoice billing map from restaurantInvoices line items
    // Used as primary source for per-item billed amounts (catalog prices often unmapped/0)
    const invoiceBillMap = {}; // itemName → { totalBilled, totalQty }
    try {
        const restInvSnap = await getDocs(collection(db, 'restaurantInvoices'));
        restInvSnap.docs.forEach(d => {
            const inv = d.data();
            (inv.items || []).forEach(line => {
                const itemName = line.itemName || line.name;
                if (!itemName) return;
                const lineBilled =
                    parseFloat(line.lineTotal ?? line.lineTotalAfterTax ?? line.lineSubtotal ?? 0) ||
                    (parseFloat(line.price || line.vendorPrice || 0) * (parseFloat(line.qty) || 1));
                const qty = parseFloat(line.qty) || 1;
                if (!invoiceBillMap[itemName]) invoiceBillMap[itemName] = { totalBilled: 0, totalQty: 0 };
                invoiceBillMap[itemName].totalBilled += lineBilled;
                invoiceBillMap[itemName].totalQty += qty;
            });
        });
    } catch (e) {
        console.warn('[DispatchOpt] Could not load invoice billing map:', e);
    }

    // 3. Aggregate items by vendor + delivery day
    // key: "vendorName|day" → { items: [{ itemName, qty, category }] }
    const groups = {};

    weekOrders.forEach(order => {
        const day = order.deliveryDay || 'Monday';
        (order.items || []).forEach(line => {
            const itemName = line.name || line.itemName;
            if (!itemName) return;
            const qty = Number(line.qty) || 0;
            if (qty <= 0) return;

            const cat = catalogLookup[itemName] || {};
            const vendor = cat.vendor || 'Unknown Vendor';
            const key = `${vendor}|${day}`;

            if (!groups[key]) {
                groups[key] = {
                    vendor,
                    vendorId: cat.vendorId || '',
                    day,
                    items: [],
                    totalQty: 0,
                    totalValue: 0,
                    categories: new Set(),
                    restaurants: new Set(),
                };
            }

            // Check if item already in group
            const existing = groups[key].items.find(i => i.itemName === itemName);
            if (existing) {
                existing.qty += qty;
            } else {
                groups[key].items.push({
                    itemName,
                    qty,
                    category: line.category || cat.category || 'Produce',
                    unitPrice: cat.price || 0,
                });
            }
            groups[key].totalQty += qty;
            // Use real invoice billed amount if available, else estimate from catalog price
            const invoiceEntry = invoiceBillMap[itemName];
            const itemBilled = invoiceEntry?.totalBilled > 0
                ? (qty / Math.max(invoiceEntry.totalQty, 1)) * invoiceEntry.totalBilled
                : qty * (cat.price || 0);
            groups[key].totalValue += itemBilled;
            groups[key].categories.add(line.category || cat.category || 'Produce');
            groups[key].restaurants.add(order.restaurantName || order.restaurantId || 'Unknown');
        });
    });

    // 4. Build consolidation suggestions (groups with 2+ items)
    const suggestions = [];

    Object.values(groups).forEach(g => {
        if (g.items.length < 2) return; // Only suggest when multiple items can be combined

        const categoriesList = [...g.categories];
        const restaurantCount = g.restaurants.size;

        let reason = `Same vendor (${g.vendor}) and same delivery day (${g.day})`;
        if (categoriesList.length === 1) {
            reason += ` — all ${categoriesList[0]} items`;
        }
        if (restaurantCount > 1) {
            reason += ` — serving ${restaurantCount} restaurants`;
        }

        suggestions.push({
            id: `opt_${g.vendor}_${g.day}`.replace(/\s+/g, '_').toLowerCase(),
            vendor: g.vendor,
            vendorId: g.vendorId,
            day: g.day,
            items: g.items.sort((a, b) => b.qty - a.qty),
            itemCount: g.items.length,
            totalQty: g.totalQty,
            totalValue: Math.round(g.totalValue * 100) / 100,
            categories: categoriesList,
            restaurantCount,
            reason,
            efficiency: g.items.length >= 5 ? 'High' : g.items.length >= 3 ? 'Medium' : 'Low',
            efficiencyColor: g.items.length >= 5 ? '#34d399' : g.items.length >= 3 ? '#fbbf24' : '#94a3b8',
        });
    });

    // Sort by item count descending (most consolidation first)
    suggestions.sort((a, b) => b.itemCount - a.itemCount);

    return {
        suggestions,
        summary: {
            totalGroups: suggestions.length,
            totalItems: suggestions.reduce((s, g) => s + g.itemCount, 0),
            totalValue: Math.round(suggestions.reduce((s, g) => s + g.totalValue, 0) * 100) / 100,
            highEfficiency: suggestions.filter(s => s.efficiency === 'High').length,
            uniqueVendors: new Set(suggestions.map(s => s.vendor)).size,
        },
    };
}
