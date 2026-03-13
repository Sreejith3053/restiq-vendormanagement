/**
 * suggestedForecastJob.js
 *
 * Server-side Cloud Function that replicates the client-side forecast engine
 * (forecastHelpers.js) and writes results to Firestore for the RMS app to consume.
 *
 * Algorithm: median-blend (30% last-4-cycles + 70% last-8-cycles),
 * 1.5× cap, ≥3 appearances filter, proportional restaurant split,
 * Mon/Thu delivery day split, + correction learning.
 *
 * Writes to: `suggestedOrderAIForcast_Model/{restaurantId}_{weekStart}`
 *
 * Scheduled: Every Wednesday at 6PM EST via Cloud Scheduler.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_ALIAS_MAP = {
    'white onion': 'Onion - Cooking',
    'red onion': 'Onion - Red',
    'spring onion': 'Green Onion',
    'garlic': 'Peeled Garlic',
    'green plantain': 'Plantain Green',
    'coriander': 'Coriander Leaves',
    'mint': 'Mint Leaves',
    'onion cooking': 'Onion - Cooking',
    'onion cooking 50lbs': 'Onion - Cooking',
    'onion red 25lbs': 'Onion - Red',
    'carrot 50lbs': 'Carrot',
};

const FULFILLED_STATUSES = ['completed', 'fulfilled'];
const MIN_APPEARANCES = 3;

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

// ─── Step 1: Fetch Order History from Firestore ───────────────────────────────

async function fetchOrderHistory(db, weeksBack = 12) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (weeksBack * 7));

    const ordersRef = db.collection('marketplaceOrders');
    const snapshot = await ordersRef
        .where('createdAt', '>=', cutoff)
        .orderBy('createdAt', 'desc')
        .get();

    const flatRecords = [];

    snapshot.docs.forEach(doc => {
        const order = doc.data();
        const status = (order.status || '').toLowerCase();

        if (!FULFILLED_STATUSES.includes(status)) return;

        let dateStr = '';
        if (order.createdAt?.toDate) {
            dateStr = order.createdAt.toDate().toISOString().slice(0, 10);
        } else if (order.createdAt) {
            dateStr = new Date(order.createdAt).toISOString().slice(0, 10);
        } else if (order.pickupDate) {
            dateStr = order.pickupDate;
        }
        if (!dateStr) return;

        (order.items || []).forEach(item => {
            const rawName = item.name || item.itemName || '';
            if (!rawName) return;
            const normalizedName = normalizeItemName(rawName);

            flatRecords.push({
                date: dateStr,
                restaurantId: order.restaurantId || '',
                itemName: normalizedName,
                catalogItemId: item.catalogItemId || '',
                qty: Number(item.qty) || 0,
                unit: item.unit || item.packLabel || '',
                packLabel: item.packLabel || item.unit || '',
                category: item.category || '',
                vendor: order.vendorName || '',
            });
        });
    });

    return flatRecords;
}

// ─── Step 2: Fetch Correction History ─────────────────────────────────────────

async function fetchCorrectionHistory(db, restaurantId, deliveryDay = 'Monday') {
    if (!restaurantId) return [];

    try {
        const snapshot = await db.collection('correctionEntries')
            .where('restaurantId', '==', restaurantId)
            .where('deliveryDay', '==', deliveryDay)
            .orderBy('submittedAt', 'desc')
            .limit(100)
            .get();

        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.warn(`[SuggestedForecast] Could not fetch corrections for ${restaurantId}:`, err.message);
        return [];
    }
}

// ─── Step 3: Compute Correction Profiles ──────────────────────────────────────

function computeCorrectionProfiles(corrections) {
    if (!corrections || corrections.length === 0) return {};

    const byItem = {};
    corrections.forEach(c => {
        const key = c.catalogItemId || c.itemId;
        if (!byItem[key]) byItem[key] = { itemId: key, itemName: c.itemName || '', edits: [] };
        byItem[key].edits.push(c);
    });

    const profiles = {};

    Object.values(byItem).forEach(item => {
        const edits = item.edits.slice(0, 8);
        const historyCount = edits.length;

        if (historyCount < 3) {
            profiles[item.itemId] = {
                itemId: item.itemId,
                itemName: item.itemName,
                historyCount,
                confidence: 'Low',
                recommendedCorrection: 0,
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

        let confidence = 'Low';
        if (consistencyRatio >= 0.75 && historyCount >= 4) confidence = 'High';
        else if (consistencyRatio >= 0.60 && historyCount >= 3) confidence = 'Medium';

        let recommendedCorrection = 0;
        if ((confidence === 'High' || confidence === 'Medium') && directionConsistency !== 'Unchanged') {
            recommendedCorrection = Math.round(avgDelta * 0.5);
        }

        let hint = 'No correction needed';
        if (confidence !== 'Low') {
            if (recommendedCorrection > 0) hint = `Learned +${recommendedCorrection} (${confidence} confidence)`;
            else if (recommendedCorrection < 0) hint = `Learned ${recommendedCorrection} (${confidence} confidence)`;
        } else if (directionConsistency === 'Mixed') {
            hint = 'Mixed editing pattern';
        }

        profiles[item.itemId] = {
            itemId: item.itemId,
            itemName: item.itemName,
            historyCount,
            confidence,
            recommendedCorrection,
            hint,
        };
    });

    return profiles;
}

// ─── Step 4: Build Forecast for a Single Restaurant ───────────────────────────

function buildRestaurantForecast(records, restaurantId, allRestaurants, correctionProfiles = {}) {
    if (!records.length) return [];

    const allDatesSet = new Set();
    records.forEach(r => { if (r.date) allDatesSet.add(r.date); });
    const allCycles = [...allDatesSet].sort((a, b) => new Date(b) - new Date(a));
    const last8Cycles = allCycles.slice(0, 8);
    const last4Cycles = allCycles.slice(0, 4);

    const globalHistoryMap = {};
    const restHistoryMap = {};
    const categoryMap = {};
    const packLabelMap = {};
    const catalogItemIdMap = {};

    records.forEach(r => {
        const name = r.itemName;
        if (!name) return;

        if (r.category && !categoryMap[name]) categoryMap[name] = r.category;
        if (r.packLabel && !packLabelMap[name]) packLabelMap[name] = r.packLabel;
        if (r.catalogItemId && !catalogItemIdMap[name]) catalogItemIdMap[name] = r.catalogItemId;

        if (!globalHistoryMap[name]) {
            globalHistoryMap[name] = { orderHistoryMap: {}, totalVolume8Wks: 0 };
        }
        if (!globalHistoryMap[name].orderHistoryMap[r.date]) {
            globalHistoryMap[name].orderHistoryMap[r.date] = 0;
        }
        globalHistoryMap[name].orderHistoryMap[r.date] += r.qty;

        if (last8Cycles.includes(r.date)) {
            globalHistoryMap[name].totalVolume8Wks += r.qty;

            if (!restHistoryMap[name]) restHistoryMap[name] = {};
            if (!restHistoryMap[name][r.restaurantId]) restHistoryMap[name][r.restaurantId] = 0;
            restHistoryMap[name][r.restaurantId] += r.qty;
        }
    });

    const results = [];

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

        // Cap at 1.5× median_8
        const cap = Math.ceil(median8 * 1.5) || 0;
        if (cap > 0 && predictedTotal > cap) predictedTotal = cap;

        // Qualify: ≥3 appearances
        if (qtyIn8Filtered.length < MIN_APPEARANCES || predictedTotal <= 0) return;

        // Proportionally allocate to selected restaurant
        let restRatio = 1.0;
        if (item.totalVolume8Wks > 0 && restHistoryMap[itemName]?.[restaurantId]) {
            restRatio = restHistoryMap[itemName][restaurantId] / item.totalVolume8Wks;
        } else if (item.totalVolume8Wks > 0 && restHistoryMap[itemName]) {
            restRatio = 0.0;
        } else if (item.totalVolume8Wks > 0 || predictedTotal > 0) {
            restRatio = 1.0 / (allRestaurants.length || 1);
        }

        let restAllocatedTotal = Math.round(predictedTotal * restRatio);
        if (restAllocatedTotal <= 0) return;

        // Split to delivery days
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

        // Confidence
        let confidence = 'Low';
        if (qtyIn8Filtered.length >= 7) confidence = 'High';
        else if (qtyIn8Filtered.length >= 4) confidence = 'Medium';

        // Apply learned corrections (match by catalogItemId)
        const itemId = catalogItemIdMap[itemName] || itemName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const corrProfile = correctionProfiles[itemId];
        let learnedCorrection = 0;
        let correctionHint = null;

        if (corrProfile && (corrProfile.confidence === 'High' || corrProfile.confidence === 'Medium') && corrProfile.recommendedCorrection !== 0) {
            learnedCorrection = corrProfile.recommendedCorrection;
            correctionHint = corrProfile.hint;
        } else if (corrProfile && corrProfile.historyCount < 3) {
            correctionHint = 'Not enough history';
        }

        const correctedQty = Math.max(0, restAllocatedTotal + learnedCorrection);

        results.push({
            id: itemId,
            catalogItemId: catalogItemIdMap[itemName] || '',
            itemName,
            category: cat || 'Produce',
            packLabel: packLabelMap[itemName] || 'unit',
            predictedQty: correctedQty,
            rawPrediction: restAllocatedTotal,
            mondayQty,
            thursdayQty,
            confidence,
            trend,
            learnedCorrection,
            correctionHint,
            globalForecast: predictedTotal,
            restRatio: Math.round(restRatio * 100),
        });
    });

    // Sort by confidence desc, then qty desc
    results.sort((a, b) => {
        const confOrder = { High: 0, Medium: 1, Low: 2 };
        return (confOrder[a.confidence] || 2) - (confOrder[b.confidence] || 2) || b.predictedQty - a.predictedQty;
    });

    return results;
}

// ─── Main Job Runner ──────────────────────────────────────────────────────────

async function runSuggestedForecastJob(db) {
    console.log('[SuggestedForecast] Starting scheduled forecast job...');

    // 1. Fetch order history
    const records = await fetchOrderHistory(db, 12);
    console.log(`[SuggestedForecast] Loaded ${records.length} order records from Firestore`);

    if (records.length === 0) {
        console.log('[SuggestedForecast] No order records found. Skipping.');
        return { success: true, restaurants: 0, message: 'No order data' };
    }

    // 2. Discover all restaurants
    const restaurantSet = new Set();
    records.forEach(r => { if (r.restaurantId) restaurantSet.add(r.restaurantId); });
    const allRestaurants = Array.from(restaurantSet).sort();
    console.log(`[SuggestedForecast] Discovered ${allRestaurants.length} restaurant(s): ${allRestaurants.join(', ')}`);

    // 3. Compute the delivery week start (next Monday from today)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(0, 0, 0, 0);
    const weekStart = nextMonday.toISOString().slice(0, 10);
    console.log(`[SuggestedForecast] Forecast week start: ${weekStart}`);

    // 4. Build forecast for each restaurant and write to Firestore
    const batch = db.batch();
    let restaurantCount = 0;

    for (const restaurantId of allRestaurants) {
        // Compute diagnostic stats for this restaurant
        const restRecords = records.filter(r => r.restaurantId === restaurantId);
        const uniqueDates = new Set(restRecords.map(r => r.date));
        const uniqueItems = new Set(restRecords.map(r => r.itemName));
        const orderCycles = uniqueDates.size;

        // Calculate per-item appearances across the last 8 cycles (global)
        const allDatesSet = new Set(records.map(r => r.date));
        const sortedDates = [...allDatesSet].sort((a, b) => new Date(b) - new Date(a));
        const last8 = sortedDates.slice(0, 8);
        const itemAppearances = {};
        restRecords.forEach(r => {
            if (!last8.includes(r.date)) return;
            if (!itemAppearances[r.itemName]) itemAppearances[r.itemName] = new Set();
            itemAppearances[r.itemName].add(r.date);
        });

        let bestItemAppearances = 0;
        let qualifiedItemCount = 0;
        Object.values(itemAppearances).forEach(dateSet => {
            const count = dateSet.size;
            if (count > bestItemAppearances) bestItemAppearances = count;
            if (count >= MIN_APPEARANCES) qualifiedItemCount++;
        });

        // Status label and color
        let statusLabel, statusColor;
        if (orderCycles === 0) {
            statusLabel = 'No completed orders for this restaurant';
            statusColor = '#ef4444';
        } else if (orderCycles < 8) {
            statusLabel = `Need 8 order cycles — have ${orderCycles} so far`;
            statusColor = '#f59e0b';
        } else if (qualifiedItemCount === 0) {
            statusLabel = `Have ${orderCycles} cycles but no item appears in ${MIN_APPEARANCES}+ of them`;
            statusColor = '#f59e0b';
        } else {
            statusLabel = `${qualifiedItemCount} item${qualifiedItemCount !== 1 ? 's' : ''} ready for forecasting`;
            statusColor = '#10b981';
        }

        const orderStats = {
            totalRecords: records.length,
            restaurantRecords: restRecords.length,
            uniqueOrderDates: orderCycles,
            uniqueItems: uniqueItems.size,
            requiredCycles: 8,
            requiredItemAppearances: MIN_APPEARANCES,
            cyclesShortfall: Math.max(0, 8 - orderCycles),
            bestItemAppearances,
            qualifiedItemCount,
            isReady: qualifiedItemCount > 0,
            statusLabel,
            statusColor,
        };

        // Fetch corrections for this restaurant
        let correctionProfiles = {};
        try {
            const corrections = await fetchCorrectionHistory(db, restaurantId, 'Monday');
            correctionProfiles = computeCorrectionProfiles(corrections);
        } catch (err) {
            console.warn(`[SuggestedForecast] Could not load corrections for ${restaurantId}:`, err.message);
        }

        // Build the forecast
        const forecastLines = buildRestaurantForecast(records, restaurantId, allRestaurants, correctionProfiles);

        // Write document — even if no qualifying items (with status + diagnostics)
        const docId = `${restaurantId}_${weekStart}`;
        const docRef = db.collection('suggestedOrderAIForcast_Model').doc(docId);

        if (forecastLines.length === 0) {
            // Insufficient data — write diagnostic doc
            batch.set(docRef, {
                restaurantId,
                weekStart,
                generatedAt: new Date().toISOString(),
                status: 'insufficient_data',
                forecastLines: [],
                summary: { totalItems: 0, totalPacks: 0, totalMondayPacks: 0, totalThursdayPacks: 0 },
                orderStats,
            });
            console.log(`[SuggestedForecast] ⚠ "${restaurantId}" — insufficient data (${orderCycles} cycles, best item: ${bestItemAppearances}/${MIN_APPEARANCES} appearances)`);
        } else {
            // Ready — write full forecast
            const summary = {
                totalItems: forecastLines.length,
                totalPacks: forecastLines.reduce((s, l) => s + l.predictedQty, 0),
                totalMondayPacks: forecastLines.reduce((s, l) => s + l.mondayQty, 0),
                totalThursdayPacks: forecastLines.reduce((s, l) => s + l.thursdayQty, 0),
            };

            batch.set(docRef, {
                restaurantId,
                weekStart,
                generatedAt: new Date().toISOString(),
                status: 'ready',
                forecastLines,
                summary,
                orderStats,
            });
            console.log(`[SuggestedForecast] ✓ "${restaurantId}" — ${forecastLines.length} items, ${summary.totalPacks} total packs`);
        }

        restaurantCount++;
    }

    await batch.commit();
    console.log(`[SuggestedForecast] ✅ Complete — wrote forecasts for ${restaurantCount} restaurant(s) to suggestedOrderAIForcast_Model`);

    return { success: true, restaurants: restaurantCount, weekStart };
}

module.exports = { runSuggestedForecastJob };
