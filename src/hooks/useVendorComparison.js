/**
 * useVendorComparison.js
 *
 * Data hook for the Vendor Comparison Engine.
 * Fetches vendor items from Firestore, groups them by normalized catalog name,
 * runs comparison logic, and estimates monthly usage from recent orders.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../firebase';
import {
    collection, getDocs, query, where,
    orderBy, limit, Timestamp
} from 'firebase/firestore';
import { compareVendorsForItem } from '../components/Vendors/vendorComparisonEngine';

// ── Normalize item name for grouping ──────────────────────────────────────────
function normalizeItemName(name) {
    return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Estimate base-unit quantity from pack quantity ─────────────────────────────
function estimateBaseQty(packQty, packSize) {
    if (!packSize) return packQty;
    const m = String(packSize).toLowerCase().match(/^([\d.]+)\s*([a-z]+)/);
    if (!m) return packQty;
    return packQty * parseFloat(m[1]);
}

export default function useVendorComparison() {
    const [groups,   setGroups]   = useState([]);  // compared item groups
    const [nonComparable, setNonComparable] = useState([]); // review items
    const [kpis,     setKpis]     = useState(null);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState(null);
    const [lastFetched, setLastFetched] = useState(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // ── 1. Fetch all vendors ──────────────────────────────────────
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            const vendorMeta  = {};
            vendorsSnap.docs.forEach(d => {
                vendorMeta[d.id] = { vendorId: d.id, vendorName: d.data().name || d.id, ...d.data() };
            });

            // ── 2. Fetch all vendor items ─────────────────────────────────
            const allOffers = []; // { vendorId, vendorName, itemName, price, packSize, category, updatedAt }
            for (const vId of Object.keys(vendorMeta)) {
                try {
                    const itemsSnap = await getDocs(collection(db, `vendors/${vId}/items`));
                    itemsSnap.docs.forEach(d => {
                        const data = d.data();
                        if (data.status === 'inactive') return;
                        const price = parseFloat(data.vendorPrice) || parseFloat(data.price) || 0;
                        if (price <= 0) return;
                        allOffers.push({
                            vendorId:    vId,
                            vendorName:  vendorMeta[vId]?.vendorName || vId,
                            itemDocId:   d.id,
                            itemName:    data.name || '',
                            price,
                            packSize:    data.packSize || data.unitSize || data.pack_size || '',
                            category:    data.category || '',
                            updatedAt:   data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || null,
                            // Optionally carry reliability/availability stats if stored
                            reliabilityScore:  data.reliabilityScore  ?? null,
                            availabilityScore: data.availabilityScore ?? null,
                            responseScore:     data.responseScore     ?? null,
                            capacityScore:     data.capacityScore     ?? null,
                        });
                    });
                } catch (_) { /* skip vendors with no items collection */ }
            }

            // ── 3. Estimate monthly usage from recent orders ──────────────
            const usageMap = {}; // itemName (normalized) → total qty last 30 days
            try {
                const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
                const ordersSnap = await getDocs(
                    query(collection(db, 'marketplaceOrders'),
                          where('createdAt', '>=', thirtyDaysAgo),
                          limit(500))
                );
                ordersSnap.docs.forEach(d => {
                    const data = d.data();
                    const items = data.items || data.orderItems || [];
                    items.forEach(it => {
                        const key = normalizeItemName(it.name || it.itemName || '');
                        if (!key) return;
                        const qty     = parseFloat(it.quantity) || parseFloat(it.qty) || 1;
                        const pack    = it.packSize || it.unitSize || '';
                        const baseQty = estimateBaseQty(qty, pack);
                        usageMap[key] = (usageMap[key] || 0) + baseQty;
                    });
                });
            } catch (_) { /* orders collection may not exist yet */ }

            // ── 4. Group offers by normalized item name ───────────────────
            const itemGroups = {}; // normalizedName → { itemName, category, offers[] }
            allOffers.forEach(o => {
                const key = normalizeItemName(o.itemName);
                if (!key) return;
                if (!itemGroups[key]) {
                    itemGroups[key] = { itemName: o.itemName, category: o.category, offers: [] };
                }
                itemGroups[key].offers.push(o);
            });

            // ── 5. Run comparison per group ───────────────────────────────
            const comparable    = [];
            const nonComp       = [];

            for (const [key, group] of Object.entries(itemGroups)) {
                if (group.offers.length < 2) continue; // skip single-vendor items

                const monthlyUsage = usageMap[key] || 0;
                const result = compareVendorsForItem(group.itemName, group.offers, monthlyUsage);
                if (!result) continue;

                result.category     = group.category || group.offers[0]?.category || '';
                result.monthlyUsage = monthlyUsage;

                if (result.comparability.status === 'non-comparable') {
                    nonComp.push(result);
                } else {
                    comparable.push(result);
                }
            }

            // Sort comparable by savings potential desc
            comparable.sort((a, b) => (b.savings?.monthly || 0) - (a.savings?.monthly || 0));

            // ── 6. Build KPIs ─────────────────────────────────────────────
            const totalSavings       = comparable.reduce((s, g) => s + (g.savings?.monthly || 0), 0);
            const avgSpread          = comparable.length > 0
                ? parseFloat((comparable.reduce((s, g) => s + (g.stats?.spread || 0), 0) / comparable.length).toFixed(1))
                : 0;
            const uniqueVendorIds    = new Set(allOffers.map(o => o.vendorId));
            const bestOpportunity    = comparable[0]?.itemName || '—';

            setGroups(comparable);
            setNonComparable(nonComp);
            setKpis({
                comparableItems:    comparable.length,
                vendorsCompared:    uniqueVendorIds.size,
                monthlySavings:     parseFloat(totalSavings.toFixed(2)),
                avgMarketSpread:    avgSpread,
                needsReview:        nonComp.length,
                bestOpportunity,
            });
            setLastFetched(new Date());
        } catch (err) {
            console.error('[useVendorComparison] Failed:', err);
            setError(err.message || 'Failed to load comparison data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    return { groups, nonComparable, kpis, loading, error, refresh: fetchData, lastFetched };
}
