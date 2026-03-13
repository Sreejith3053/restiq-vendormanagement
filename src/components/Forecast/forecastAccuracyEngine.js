/**
 * forecastAccuracyEngine.js
 *
 * Computes forecast accuracy by comparing AI predictions against
 * actual submittedOrders, and aggregates correction intelligence
 * from the correction learning system.
 *
 * All data is real — sourced from Firestore.
 */
import { db } from '../../firebase';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { fetchOrderHistory, getRestaurantList, buildRestaurantForecast } from './forecastHelpers';

// ─── Forecast Accuracy ────────────────────────────────────────────────────────

/**
 * Compare forecast predictions against actual submitted orders for the current week.
 * Returns accuracy metrics: { accuracy, correct, overPredicted, underPredicted, totalPredicted, details }
 */
export async function computeForecastAccuracy() {
    try {
        // 1. Get forecast predictions (from order history)
        const records = await fetchOrderHistory(12);
        if (records.length === 0) return getEmptyAccuracy();

        const restaurants = getRestaurantList(records);
        const forecastMap = {}; // itemName → predicted qty

        for (const rest of restaurants) {
            const forecast = buildRestaurantForecast(records, rest);
            forecast.forEach(item => {
                const total = (item.mondayQty || 0) + (item.thursdayQty || 0);
                if (total <= 0) return;
                const name = item.itemName;
                if (!forecastMap[name]) forecastMap[name] = { predicted: 0, category: item.category || 'Other' };
                forecastMap[name].predicted += total;
            });
        }

        // 2. Get actual completed orders for comparison
        const ordersRef = collection(db, 'marketplaceOrders');
        const now = new Date();
        const twoWeeksAgo = new Date(now);
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        const ordersQ = query(
            ordersRef,
            where('status', '==', 'completed'),
            where('createdAt', '>=', twoWeeksAgo),
            orderBy('createdAt', 'desc')
        );
        const ordersSnap = await getDocs(ordersQ);

        const actualMap = {}; // itemName → actual qty
        ordersSnap.docs.forEach(doc => {
            const order = doc.data();

            (order.items || []).forEach(item => {
                const name = item.name || item.itemName || '';
                if (!name) return;
                if (!actualMap[name]) actualMap[name] = 0;
                actualMap[name] += Number(item.qty) || 0;
            });
        });

        // 3. Compare forecast vs actual
        const allItems = new Set([...Object.keys(forecastMap), ...Object.keys(actualMap)]);
        let correct = 0, overPredicted = 0, underPredicted = 0;
        const details = [];

        allItems.forEach(itemName => {
            const predicted = forecastMap[itemName]?.predicted || 0;
            const actual = actualMap[itemName] || 0;

            if (predicted === 0 && actual === 0) return;

            const diff = predicted - actual;
            const threshold = Math.max(1, actual * 0.2); // 20% tolerance

            let status;
            if (Math.abs(diff) <= threshold) {
                status = 'correct';
                correct++;
            } else if (diff > 0) {
                status = 'over';
                overPredicted++;
            } else {
                status = 'under';
                underPredicted++;
            }

            details.push({
                itemName,
                predicted: Math.round(predicted),
                actual: Math.round(actual),
                diff: Math.round(diff),
                status,
                category: forecastMap[itemName]?.category || 'Other',
            });
        });

        const total = correct + overPredicted + underPredicted;
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

        return {
            accuracy,
            correct,
            overPredicted,
            underPredicted,
            totalPredicted: total,
            details: details.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)),
        };
    } catch (err) {
        console.error('[ForecastAccuracy] Error:', err);
        return getEmptyAccuracy();
    }
}

function getEmptyAccuracy() {
    return { accuracy: 0, correct: 0, overPredicted: 0, underPredicted: 0, totalPredicted: 0, details: [] };
}

// ─── Correction Intelligence ──────────────────────────────────────────────────

/**
 * Aggregate correction learning data across all restaurants.
 * Returns: { activeItems, avgDelta, improvementPct, mostCorrected, mostIncreased, mostReduced, profiles }
 */
export async function computeCorrectionIntelligence() {
    try {
        // Fetch all correction entries (not filtered by restaurant)
        const correctionsRef = collection(db, 'correctionEntries');
        const q = query(correctionsRef, orderBy('submittedAt', 'desc'), limit(500));
        const snap = await getDocs(q);

        if (snap.empty) return getEmptyCorrectionData();

        const corrections = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Group by catalogItemId
        const byItem = {};
        corrections.forEach(c => {
            const key = c.catalogItemId || c.itemId || c.itemName;
            if (!byItem[key]) byItem[key] = { itemId: key, itemName: c.itemName || key, edits: [] };
            byItem[key].edits.push(c);
        });

        const profiles = Object.values(byItem).map(item => {
            const edits = item.edits.slice(0, 8); // last 8
            const totalDelta = edits.reduce((sum, e) => sum + (e.deltaQty || 0), 0);
            const avgDelta = edits.length > 0 ? totalDelta / edits.length : 0;
            const increasedCount = edits.filter(e => (e.deltaQty || 0) > 0).length;
            const reducedCount = edits.filter(e => (e.deltaQty || 0) < 0).length;

            return {
                itemName: item.itemName,
                editCount: edits.length,
                avgDelta: Number(avgDelta.toFixed(1)),
                increasedCount,
                reducedCount,
                totalDelta: Number(totalDelta.toFixed(1)),
            };
        });

        // Compute aggregates
        const activeItems = profiles.filter(p => p.editCount >= 3).length;
        const allDeltas = profiles.map(p => p.avgDelta);
        const globalAvgDelta = allDeltas.length > 0
            ? Number((allDeltas.reduce((s, d) => s + d, 0) / allDeltas.length).toFixed(1))
            : 0;

        // Improvement is approximated by how many items are converging (low delta)
        const convergingItems = profiles.filter(p => Math.abs(p.avgDelta) <= 1 && p.editCount >= 3).length;
        const improvementPct = activeItems > 0 ? Math.round((convergingItems / activeItems) * 100) : 0;

        // Find extremes
        const sorted = [...profiles].sort((a, b) => b.editCount - a.editCount);
        const mostCorrected = sorted[0]?.itemName || '—';

        const increased = [...profiles].sort((a, b) => b.avgDelta - a.avgDelta);
        const mostIncreased = increased[0]?.avgDelta > 0 ? increased[0].itemName : '—';

        const reduced = [...profiles].sort((a, b) => a.avgDelta - b.avgDelta);
        const mostReduced = reduced[0]?.avgDelta < 0 ? reduced[0].itemName : '—';

        return {
            activeItems,
            avgDelta: globalAvgDelta > 0 ? `+${globalAvgDelta}` : `${globalAvgDelta}`,
            improvementPct: `${improvementPct}%`,
            mostCorrected,
            mostIncreased,
            mostReduced,
            profiles,
        };
    } catch (err) {
        console.error('[CorrectionIntelligence] Error:', err);
        return getEmptyCorrectionData();
    }
}

function getEmptyCorrectionData() {
    return {
        activeItems: 0,
        avgDelta: '0',
        improvementPct: '0%',
        mostCorrected: '—',
        mostIncreased: '—',
        mostReduced: '—',
        profiles: [],
    };
}
