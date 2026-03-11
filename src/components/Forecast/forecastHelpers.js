/**
 * forecastHelpers.js
 *
 * Shared forecast utility that reads real order history from Firestore
 * `marketplaceOrders` collection and produces per-restaurant item forecasts.
 *
 * Also integrates correction learning from `forecastCorrections` collection
 * so that all consumers get corrected predictions (Option B architecture).
 *
 * Algorithm: purely data-driven median-blend (30% last-4-cycles + 70% last-8-cycles),
 * proportional restaurant split, Mon/Thu delivery day split,
 * + learned corrections from historical user edits.
 *
 * No hardcoded minimums or exclusions — all forecasts derive from actual order data.
 */
import { db } from '../../firebase';
import { collection, query, where, orderBy, getDocs, Timestamp, limit } from 'firebase/firestore';

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_ALIAS_MAP = {
    'white onion': 'Onion - Cooking',
    'red onion': 'Onion - Red',
    'spring onion': 'Green Onion',
    'garlic': 'Peeled Garlic',
    'green plantain': 'Plantain Green',
    'Coriander': 'Coriander Leaves',
    'Mint': 'Mint Leaves',
    'Onion Cooking': 'Onion - Cooking',
    'Onion Cooking 50lbs': 'Onion - Cooking',
    'Onion Red 25lbs': 'Onion - Red',
    'Carrot 50lbs': 'Carrot',
};

// Only count these statuses as actual fulfilled orders
const FULFILLED_STATUSES = ['fulfilled', 'completed', 'delivered', 'delivered_awaiting_confirmation', 'pending_fulfillment'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeItemName(name) {
    if (!name) return '';
    const n = name.trim().toLowerCase();
    const mappedKey = Object.keys(ITEM_ALIAS_MAP).find(k => k.toLowerCase() === n);
    return mappedKey ? ITEM_ALIAS_MAP[mappedKey] : name.trim();
}

function getMedian(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
}

// ─── Firestore Data Fetch ─────────────────────────────────────────────────────

/**
 * Fetch completed marketplace orders from the last N weeks.
 * Returns flat records: { date, restaurantId, itemName, qty, unit, category, vendor }
 */
export async function fetchOrderHistory(weeksBack = 12) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (weeksBack * 7));

    // Query Firestore — only fulfilled orders from the cutoff date forward
    const ordersRef = collection(db, 'marketplaceOrders');
    const q = query(
        ordersRef,
        where('createdAt', '>=', Timestamp.fromDate(cutoff)),
        orderBy('createdAt', 'desc')
    );

    const snapshot = await getDocs(q);
    const flatRecords = [];

    snapshot.docs.forEach(doc => {
        const order = doc.data();
        const status = (order.status || '').toLowerCase();

        // Only count fulfilled/delivered orders
        if (!FULFILLED_STATUSES.includes(status)) return;

        // Get date string from createdAt
        let dateStr = '';
        if (order.createdAt?.toDate) {
            dateStr = order.createdAt.toDate().toISOString().slice(0, 10);
        } else if (order.createdAt) {
            dateStr = new Date(order.createdAt).toISOString().slice(0, 10);
        } else if (order.pickupDate) {
            dateStr = order.pickupDate;
        }
        if (!dateStr) return;

        // Flatten items array
        (order.items || []).forEach(item => {
            const rawName = item.name || item.itemName || '';
            if (!rawName) return;
            const normalizedName = normalizeItemName(rawName);

            flatRecords.push({
                date: dateStr,
                restaurantId: order.restaurantId || '',
                itemName: normalizedName,
                qty: Number(item.qty) || 0,
                unit: item.unit || '',
                category: item.category || '',
                vendor: order.vendorName || '',
            });
        });
    });

    return flatRecords;
}

/**
 * Extract unique restaurant IDs from order records.
 */
export function getRestaurantList(records) {
    const set = new Set();
    records.forEach(r => { if (r.restaurantId) set.add(r.restaurantId); });
    return Array.from(set).sort();
}

/**
 * Get order statistics for a specific restaurant — used by the empty state UI
 * to explain why the forecast has no items.
 *
 * The forecast algorithm requires:
 *   - At least 8 order cycles (dates) in the window
 *   - Each item must appear in at least 6 of the last 8 cycles
 * This function checks both conditions and reports accurately.
 */
export function getOrderStats(records, restaurantId) {
    const REQUIRED_CYCLES = 8;     // algorithm looks at last 8 cycles
    const REQUIRED_ITEM_APPEARANCES = 6; // items need 6/8 to qualify

    if (!records || records.length === 0) {
        return {
            totalRecords: 0,
            restaurantRecords: 0,
            uniqueOrderDates: 0,
            uniqueItems: 0,
            requiredCycles: REQUIRED_CYCLES,
            requiredItemAppearances: REQUIRED_ITEM_APPEARANCES,
            cyclesShortfall: REQUIRED_CYCLES,
            bestItemAppearances: 0,
            qualifiedItemCount: 0,
            isReady: false,
            statusLabel: 'No order history',
            statusColor: '#ef4444',
        };
    }

    const restRecords = records.filter(r => r.restaurantId === restaurantId);
    const uniqueDates = new Set(restRecords.map(r => r.date));
    const uniqueItems = new Set(restRecords.map(r => r.itemName));
    const orderCycles = uniqueDates.size;
    const cyclesShortfall = Math.max(0, REQUIRED_CYCLES - orderCycles);

    // Calculate per-item appearances across the last 8 cycles
    const sortedDates = [...uniqueDates].sort((a, b) => new Date(b) - new Date(a));
    const last8 = sortedDates.slice(0, 8);
    const itemAppearances = {}; // itemName → count of cycles it appeared in
    restRecords.forEach(r => {
        if (!last8.includes(r.date)) return;
        const key = r.itemName;
        if (!itemAppearances[key]) itemAppearances[key] = new Set();
        itemAppearances[key].add(r.date);
    });

    let bestItemAppearances = 0;
    let qualifiedItemCount = 0;
    Object.values(itemAppearances).forEach(dateSet => {
        const count = dateSet.size;
        if (count > bestItemAppearances) bestItemAppearances = count;
        if (count >= REQUIRED_ITEM_APPEARANCES) qualifiedItemCount++;
    });

    // Determine status
    let statusLabel, statusColor;
    if (orderCycles === 0) {
        statusLabel = 'No completed orders for this restaurant';
        statusColor = '#ef4444';
    } else if (orderCycles < REQUIRED_CYCLES) {
        statusLabel = `Need ${REQUIRED_CYCLES} order cycles — have ${orderCycles} so far`;
        statusColor = '#f59e0b';
    } else if (qualifiedItemCount === 0) {
        statusLabel = `Have ${orderCycles} cycles but no item appears in ${REQUIRED_ITEM_APPEARANCES}+ of them`;
        statusColor = '#f59e0b';
    } else {
        statusLabel = `${qualifiedItemCount} item${qualifiedItemCount !== 1 ? 's' : ''} ready for forecasting`;
        statusColor = '#10b981';
    }

    return {
        totalRecords: records.length,
        restaurantRecords: restRecords.length,
        uniqueOrderDates: orderCycles,
        uniqueItems: uniqueItems.size,
        requiredCycles: REQUIRED_CYCLES,
        requiredItemAppearances: REQUIRED_ITEM_APPEARANCES,
        cyclesShortfall,
        bestItemAppearances,
        qualifiedItemCount,
        isReady: orderCycles >= REQUIRED_CYCLES && qualifiedItemCount > 0,
        statusLabel,
        statusColor,
    };
}

// ─── Correction Learning ──────────────────────────────────────────────────────

/**
 * Fetch correction history from Firestore `forecastCorrections` for a restaurant.
 * Returns raw correction rows grouped by itemId.
 */
export async function fetchCorrectionHistory(restaurantId, deliveryDay = 'Monday') {
    if (!restaurantId) return [];

    try {
        const correctionsRef = collection(db, 'forecastCorrections');
        const q = query(
            correctionsRef,
            where('restaurantId', '==', restaurantId),
            where('deliveryDay', '==', deliveryDay),
            orderBy('submittedAt', 'desc'),
            limit(100) // enough to cover 8 weeks × ~12 items
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.warn('[Forecast] Could not fetch correction history:', err.message);
        return [];
    }
}

/**
 * Compute correction profiles from raw correction rows.
 * Same algorithm as the original useCorrectionLearning hook.
 *
 * Returns: { itemId → { recommendedCorrection, confidence, hint, ... } }
 */
export function computeCorrectionProfiles(corrections) {
    if (!corrections || corrections.length === 0) return {};

    // Group by itemId
    const byItem = {};
    corrections.forEach(c => {
        const key = c.itemId;
        if (!byItem[key]) byItem[key] = { itemId: key, itemName: c.itemName || '', edits: [] };
        byItem[key].edits.push(c);
    });

    const profiles = {};

    Object.values(byItem).forEach(item => {
        const edits = item.edits.slice(0, 8); // last 8 submissions
        const historyCount = edits.length;

        if (historyCount < 3) {
            profiles[item.itemId] = {
                itemId: item.itemId,
                itemName: item.itemName,
                historyCount,
                confidence: 'Low',
                recommendedCorrection: 0,
                status: 'Not Enough History',
                hint: 'Not enough history',
            };
            return;
        }

        const totalDelta = edits.reduce((sum, e) => sum + (e.deltaQty || 0), 0);
        const avgDelta = totalDelta / historyCount;

        const increasedCount = edits.filter(e => (e.deltaQty || 0) > 0).length;
        const reducedCount = edits.filter(e => (e.deltaQty || 0) < 0).length;
        const unchangedCount = edits.filter(e => e.deltaType === 'Unchanged' || (e.deltaQty || 0) === 0).length;

        let directionConsistency = 'Mixed';
        let activeCount = 0;

        if (increasedCount > reducedCount && increasedCount > unchangedCount) {
            directionConsistency = 'Increased';
            activeCount = increasedCount;
        } else if (reducedCount > increasedCount && reducedCount > unchangedCount) {
            directionConsistency = 'Reduced';
            activeCount = reducedCount;
        } else if (unchangedCount >= increasedCount && unchangedCount >= reducedCount) {
            directionConsistency = 'Unchanged';
            activeCount = unchangedCount;
        }

        const consistencyRatio = activeCount / historyCount;

        // Confidence scoring
        let confidence = 'Low';
        if (consistencyRatio >= 0.75 && historyCount >= 4) confidence = 'High';
        else if (consistencyRatio >= 0.60 && historyCount >= 3) confidence = 'Medium';

        // Weighted correction (50% weight to avoid swinging wildly)
        let recommendedCorrection = 0;
        if ((confidence === 'High' || confidence === 'Medium') && directionConsistency !== 'Unchanged') {
            recommendedCorrection = Math.round(avgDelta * 0.5);
        }

        let status = 'Stable / No Correction Needed';
        let hint = 'No correction needed';
        if (confidence !== 'Low') {
            if (recommendedCorrection > 0) {
                status = 'Usually Increased';
                hint = `Learned +${recommendedCorrection} (${confidence} confidence)`;
            } else if (recommendedCorrection < 0) {
                status = 'Usually Reduced';
                hint = `Learned ${recommendedCorrection} (${confidence} confidence)`;
            }
        } else if (directionConsistency === 'Mixed') {
            status = 'Volatile / Mixed Behavior';
            hint = 'Mixed editing pattern';
        }

        profiles[item.itemId] = {
            itemId: item.itemId,
            itemName: item.itemName,
            historyCount,
            avgDelta: Number(avgDelta.toFixed(1)),
            directionConsistency,
            consistencyRatio,
            confidence,
            recommendedCorrection,
            status,
            hint,
        };
    });

    return profiles;
}

// ─── Forecast Engine ──────────────────────────────────────────────────────────

/**
 * Build a per-restaurant item forecast using the order history records.
 *
 * Algorithm (purely data-driven):
 *   1. Group records by date to find order "cycles"
 *   2. For each item, aggregate qty per cycle
 *   3. Compute median over last 8 and last 4 cycles
 *   4. Blend: forecast = 30% × median_4 + 70% × median_8
 *   5. Cap at 1.5× median_8 to prevent outlier spikes
 *   6. Proportionally split to the selected restaurant
 *   7. Split to delivery days (Mon 60% / Thu 40%)
 *
 * @param {Array} records — flat order records from fetchOrderHistory()
 * @param {string} restaurantId — which restaurant to forecast for
 * @param {Array} allRestaurants — list of all restaurant IDs
 * @param {Object} [correctionProfiles] — optional correction profiles from computeCorrectionProfiles()
 * @returns {Array} — forecast lines ready for SuggestedOrderReview, with corrections applied
 */
export function buildRestaurantForecast(records, restaurantId, allRestaurants, correctionProfiles = {}) {
    if (!records.length) return [];

    // 1. Find unique dates (order cycles), sorted desc
    const allDatesSet = new Set();
    records.forEach(r => { if (r.date) allDatesSet.add(r.date); });
    const allCycles = [...allDatesSet].sort((a, b) => new Date(b) - new Date(a));
    const last8Cycles = allCycles.slice(0, 8);
    const last4Cycles = allCycles.slice(0, 4);

    // 2. Build global history map + restaurant volume tracker
    const globalHistoryMap = {};    // itemName → { orderHistoryMap: { date → qty }, totalVolume8Wks }
    const restHistoryMap = {};      // itemName → { restaurantId → totalQty }
    const categoryMap = {};         // itemName → category

    records.forEach(r => {
        const name = r.itemName;
        if (!name) return;

        // Track category
        if (r.category && !categoryMap[name]) categoryMap[name] = r.category;

        // Global history — aggregate qty by date
        if (!globalHistoryMap[name]) {
            globalHistoryMap[name] = { orderHistoryMap: {}, totalVolume8Wks: 0 };
        }
        if (!globalHistoryMap[name].orderHistoryMap[r.date]) {
            globalHistoryMap[name].orderHistoryMap[r.date] = 0;
        }
        globalHistoryMap[name].orderHistoryMap[r.date] += r.qty;

        // Restaurant volume tracking (for ratio split)
        if (last8Cycles.includes(r.date)) {
            globalHistoryMap[name].totalVolume8Wks += r.qty;

            if (!restHistoryMap[name]) restHistoryMap[name] = {};
            if (!restHistoryMap[name][r.restaurantId]) restHistoryMap[name][r.restaurantId] = 0;
            restHistoryMap[name][r.restaurantId] += r.qty;
        }
    });

    // 3. Compute forecasts per item (purely data-driven)
    const results = [];

    console.log(`[Forecast] Building forecast for "${restaurantId}" | ${last8Cycles.length} order cycles | ${Object.keys(globalHistoryMap).length} unique items found`);

    Object.keys(globalHistoryMap).forEach(itemName => {
        const item = globalHistoryMap[itemName];
        const qtyIn8Filtered = last8Cycles.map(d => item.orderHistoryMap[d] || 0).filter(q => q > 0);
        const qtyIn8 = last8Cycles.map(d => item.orderHistoryMap[d] || 0);
        const qtyIn4 = last4Cycles.map(d => item.orderHistoryMap[d] || 0);

        const median8 = getMedian(qtyIn8);
        const median4 = getMedian(qtyIn4);
        const cat = categoryMap[itemName] || '';

        // Blend: 30% recent + 70% historical
        let forecastQty = (0.3 * median4) + (0.7 * median8);
        let predictedTotal = Math.ceil(forecastQty);

        // Cap at 1.5× median_8 to prevent outlier spikes
        const cap = Math.ceil(median8 * 1.5) || 0;
        if (cap > 0 && predictedTotal > cap) predictedTotal = cap;

        // Qualify: item must appear in ≥3 of last 8 cycles with qty > 0
        const MIN_APPEARANCES = 3;
        if (qtyIn8Filtered.length < MIN_APPEARANCES || predictedTotal <= 0) {
            console.log(`[Forecast]   SKIP "${itemName}" | appeared in ${qtyIn8Filtered.length}/${last8Cycles.length} cycles (need ${MIN_APPEARANCES}) | predicted: ${predictedTotal}`);
            return;
        }

        console.log(`[Forecast]   ✓ "${itemName}" | appeared in ${qtyIn8Filtered.length}/${last8Cycles.length} cycles | predicted: ${predictedTotal}`);

        // 4. Proportionally allocate to selected restaurant
        let restRatio = 1.0;
        if (item.totalVolume8Wks > 0 && restHistoryMap[itemName]?.[restaurantId]) {
            restRatio = restHistoryMap[itemName][restaurantId] / item.totalVolume8Wks;
        } else if (item.totalVolume8Wks > 0 && restHistoryMap[itemName]) {
            restRatio = 0.0; // This restaurant never ordered this item
        } else if (item.totalVolume8Wks > 0 || predictedTotal > 0) {
            restRatio = 1.0 / (allRestaurants.length || 1);
        }

        let restAllocatedTotal = Math.round(predictedTotal * restRatio);
        if (restAllocatedTotal <= 0) return;

        // 5. Split to delivery days
        let mondayQty = Math.round(restAllocatedTotal * 0.6);
        let thursdayQty = restAllocatedTotal - mondayQty;

        if (['Packaging', 'Cleaning', 'Cleaning Supplies'].includes(cat)) {
            mondayQty = Math.round(restAllocatedTotal * 0.5);
            thursdayQty = restAllocatedTotal - mondayQty;
        }

        // Trend
        let trend = 'stable';
        if (median4 > median8 * 1.2) trend = 'up';
        else if (median4 < median8 * 0.8) trend = 'down';

        // Confidence (purely based on data availability)
        let confidence = 'Low';
        if (qtyIn8Filtered.length >= 7) confidence = 'High';
        else if (qtyIn8Filtered.length >= 4) confidence = 'Medium';

        // 6. Apply learned corrections from forecastCorrections
        const itemId = itemName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const corrProfile = correctionProfiles[itemId];
        let learnedCorrection = 0;
        let correctionConfidence = null;
        let correctionHint = null;

        if (corrProfile && (corrProfile.confidence === 'High' || corrProfile.confidence === 'Medium') && corrProfile.recommendedCorrection !== 0) {
            learnedCorrection = corrProfile.recommendedCorrection;
            correctionConfidence = corrProfile.confidence;
            correctionHint = corrProfile.hint;
        } else if (corrProfile && corrProfile.historyCount < 3) {
            correctionHint = 'Not enough history';
        }

        const rawPrediction = restAllocatedTotal;
        const correctedQty = Math.max(0, restAllocatedTotal + learnedCorrection);

        results.push({
            id: itemId,
            itemName,
            category: cat || 'Produce',
            packLabel: '',
            rawPrediction,
            learnedCorrection,
            correctionConfidence,
            correctionHint,
            predictedQty: correctedQty,
            finalQty: correctedQty,
            mondayQty,
            thursdayQty,
            note: '',
            confidence,
            trend,
            globalForecast: predictedTotal,
            restRatio: Math.round(restRatio * 100),
            learningProfile: corrProfile || null,
        });
    });

    // Sort by confidence desc, then qty desc
    results.sort((a, b) => {
        const confOrder = { High: 0, Medium: 1, Low: 2 };
        return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2) || b.predictedQty - a.predictedQty;
    });

    return results;
}
