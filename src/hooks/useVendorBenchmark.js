/**
 * useVendorBenchmark.js
 *
 * Data hook for the Anonymous Market Benchmark feature.
 * Fetches the vendor's own items, compares vs anonymous market aggregates,
 * and builds benchmark records using vendorBenchmarkEngine.
 *
 * PRIVACY: market aggregates are fetched as lowest/median only — no competitor
 * identities or raw prices are passed to the benchmark engine.
 */
import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, getDocs, query, where, limit, Timestamp } from 'firebase/firestore';
import { UserContext } from '../contexts/UserContext';
import React from 'react';
import { buildBenchmarkRecord } from '../components/Vendors/vendorBenchmarkEngine';
import { normalizeUnitPrice, classifyComparability } from '../components/Vendors/vendorComparisonEngine';

function normalizeName(name) {
    return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export default function useVendorBenchmark() {
    const { vendorId } = React.useContext(UserContext);

    const [records,    setRecords]    = useState([]);  // benchmark records for own items
    const [kpis,       setKpis]       = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [error,      setError]      = useState(null);
    const [lastFetched,setLastFetched]= useState(null);

    const fetchData = useCallback(async () => {
        if (!vendorId) { setLoading(false); return; }
        setLoading(true);
        setError(null);
        try {
            // ── 1. Fetch own vendor items ──────────────────────────────
            const myItemsSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
            const myItems = myItemsSnap.docs
                .map(d => ({ docId: d.id, ...d.data() }))
                .filter(d => d.status !== 'inactive');

            // ── 2. Fetch all vendors' items for market aggregates ──────
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            // Build: { normalizedItemName → [{ price, packSize, updatedAt }] }
            const marketMap = {};
            for (const vDoc of vendorsSnap.docs) {
                if (vDoc.id === vendorId) continue; // exclude own data from market
                try {
                    const snap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                    snap.docs.forEach(d => {
                        const data = d.data();
                        if (data.status === 'inactive') return;
                        const price = parseFloat(data.vendorPrice) || parseFloat(data.price) || 0;
                        if (price <= 0) return;
                        const key = normalizeName(data.name);
                        if (!key) return;
                        (marketMap[key] = marketMap[key] || []).push({
                            price,
                            packSize:  data.packSize || data.unitSize || '',
                            updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
                        });
                    });
                } catch (_) {}
            }

            // ── 3. Estimate demand tiers from recent orders ────────────
            const demandMap = {}; // normalizedItemName → { qty, tier }
            try {
                const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
                const ordersSnap    = await getDocs(
                    query(collection(db, 'marketplaceOrders'),
                          where('createdAt', '>=', thirtyDaysAgo),
                          limit(400))
                );
                ordersSnap.docs.forEach(d => {
                    const data = d.data();
                    (data.items || data.orderItems || []).forEach(it => {
                        const key = normalizeName(it.name || it.itemName || '');
                        if (!key) return;
                        const qty = parseFloat(it.quantity) || 1;
                        if (!demandMap[key]) demandMap[key] = { qty: 0 };
                        demandMap[key].qty += qty;
                    });
                });
                // Tier by median qty
                const qtys = Object.values(demandMap).map(v => v.qty).sort((a, b) => a - b);
                const medQ = qtys[Math.floor(qtys.length / 2)] || 10;
                Object.keys(demandMap).forEach(k => {
                    const q = demandMap[k].qty;
                    demandMap[k].tier = q >= medQ * 2 ? 'high' : q >= medQ * 0.5 ? 'medium' : 'low';
                });
            } catch (_) {}

            // ── 4. Build benchmark record per own item ─────────────────
            const benchmarkRecords = [];
            for (const item of myItems) {
                const key          = normalizeName(item.name);
                const myPrice      = parseFloat(item.vendorPrice) || parseFloat(item.price) || 0;
                const myPackSize   = item.packSize || item.unitSize || '';
                const marketOffers = marketMap[key] || [];

                // Normalize own price
                const myNorm = myPrice > 0 ? normalizeUnitPrice(myPrice, myPackSize) : null;
                const myUnitPrice = myNorm?.unitPrice ?? null;
                const baseUnit    = myNorm?.baseUnit  ?? null;

                // Compute market stats from OTHER vendors (anonymous aggregates)
                const comparability = classifyComparability([
                    { price: myPrice, packSize: myPackSize },
                    ...marketOffers,
                ]);
                const confidence = comparability.confidence;

                // Normalize market offers to same base unit
                const marketPrices = marketOffers
                    .map(o => normalizeUnitPrice(o.price, o.packSize)?.unitPrice)
                    .filter(p => p != null && p > 0);

                let marketBest   = null;
                let marketMedian = null;
                let priceRank    = null;
                let totalVendors = null;

                if (marketPrices.length > 0 && myUnitPrice) {
                    const allPrices = [...marketPrices, myUnitPrice].sort((a, b) => a - b);
                    marketBest   = Math.min(...marketPrices); // best among OTHER vendors only
                    const mid    = Math.floor(marketPrices.length / 2);
                    marketMedian = marketPrices.length % 2 === 0
                        ? (marketPrices[mid - 1] + marketPrices[mid]) / 2
                        : marketPrices[mid];
                    // Rank own price among all (including own)
                    priceRank    = allPrices.findIndex(p => Math.abs(p - myUnitPrice) < 0.0001) + 1;
                    totalVendors = allPrices.length;
                }

                const demand     = demandMap[key] || {};
                const demandTier = demand.tier ?? null;

                const record = buildBenchmarkRecord({
                    itemName:          item.name || '',
                    itemDocId:         item.docId,
                    category:          item.category || '',
                    vendorUnitPrice:   myUnitPrice,
                    packSize:          myPackSize,
                    marketBest,
                    marketMedian,
                    baseUnit,
                    confidencePct:     myUnitPrice && marketBest ? confidence : 0,
                    priceRank,
                    totalVendors,
                    monthlyUsage:      demand.qty || 0,
                    demandTier,
                    availabilityScore: item.availabilityScore ?? null,
                    responseScore:     item.responseScore     ?? null,
                    reliabilityScore:  item.reliabilityScore  ?? null,
                    capacityScore:     item.capacityScore     ?? null,
                    updatedAt:         item.updatedAt?.toDate?.()?.toISOString?.() || item.updatedAt || null,
                });
                benchmarkRecords.push(record);
            }

            // Sort: highest impact first (risk > opportunity > competitive)
            const bandOrder = { 'high-price-risk': 0, 'slightly-above': 1, 'competitive': 2, 'market-leading': 3, 'needs-review': 4 };
            benchmarkRecords.sort((a, b) =>
                (bandOrder[a.positionBand.band] ?? 5) - (bandOrder[b.positionBand.band] ?? 5)
            );

            // ── 5. Build KPIs ──────────────────────────────────────────
            const comparable   = benchmarkRecords.filter(r => r.isComparable);
            const competitive  = comparable.filter(r => ['market-leading', 'competitive'].includes(r.positionBand.band));
            const aboveMarket  = comparable.filter(r => ['slightly-above', 'high-price-risk'].includes(r.positionBand.band));
            const hasRecs      = benchmarkRecords.filter(r => r.recommendations.some(rec => rec.type !== 'success' && rec.type !== 'info'));

            // Average closeness to market best (0 = at best, 100 = 100% above)
            const bestProximityArr = comparable
                .filter(r => r.deltaBest !== null)
                .map(r => Math.max(0, r.deltaBest));
            const avgBestProximity = bestProximityArr.length > 0
                ? parseFloat((bestProximityArr.reduce((s, v) => s + v, 0) / bestProximityArr.length).toFixed(1))
                : 0;

            // Demand gain — number of items with meaningful opportunity
            const demandGainCount = benchmarkRecords.filter(r =>
                r.demandGain?.available && r.demandGain?.type !== 'strong'
            ).length;

            setRecords(benchmarkRecords);
            setKpis({
                itemsBenchmarked:       benchmarkRecords.length,
                competitiveItems:       competitive.length,
                aboveMarketItems:       aboveMarket.length,
                bestPriceProximity:     avgBestProximity,
                demandGainOpportunities: demandGainCount,
                improvementOpportunities: hasRecs.length,
            });
            setLastFetched(new Date());
        } catch (err) {
            console.error('[useVendorBenchmark] failed:', err);
            setError(err.message || 'Failed to load benchmark data');
        } finally {
            setLoading(false);
        }
    }, [vendorId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    return { records, kpis, loading, error, refresh: fetchData, lastFetched };
}
