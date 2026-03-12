/**
 * forecastCorrectionEngine.js
 *
 * Automatic comparison and learning engine for RestIQ Solutions.
 *
 * Fired automatically once when a restaurant submits their final order.
 * No manual trigger or AI prompt required.
 *
 * Simplified pipeline (Option B — 2 collections only):
 *  1. Write item-level correction rows to `forecast/corrections/entries`
 *  2. Write full order record to `submittedOrders`
 *
 * Collections:
 *  - forecast/corrections/entries  (item-level: predicted vs final per item per week)
 *  - submittedOrders      (full order snapshot for pipeline tracking)
 *
 * The forecast engine reads `forecast/corrections/entries` on next cycle and applies
 * learned corrections inside buildRestaurantForecast() automatically.
 */

import { db } from '../../firebase';
import {
    collection,
    doc,
    setDoc,
    serverTimestamp,
    writeBatch,
} from 'firebase/firestore';

// ── Delta type resolver (canonical) ─────────────────────────────────────────
export function getDeltaType(predictedQty, finalQty) {
    if (predictedQty === 0 && finalQty > 0) return 'Added';
    if (finalQty === 0 && predictedQty > 0) return 'Removed';
    if (finalQty > predictedQty) return 'Increased';
    if (finalQty < predictedQty) return 'Reduced';
    return 'Unchanged';
}

// ── Main exported function: run on final order submission ────────────────────
/**
 * @param {Object} params
 * @param {string} params.suggestionId      - Firestore doc ID of the suggested order
 * @param {string} params.restaurantId
 * @param {string} params.restaurantName
 * @param {string} params.deliveryDay       - 'Monday' | 'Thursday'
 * @param {string} params.weekStart         - ISO date string of week start
 * @param {Array}  params.lines             - Order lines from SuggestedOrderReview state
 *                                            Each line: { id, itemName, category, packLabel,
 *                                                        predictedQty, rawPrediction, finalQty,
 *                                                        deltaQty, deltaType, note }
 * @param {Object} params.metrics           - { predictedActiveCount, predictedPacks,
 *                                              finalActiveCount, finalPacks, changesCount,
 *                                              netDeltaPacks, confidence }
 * @param {Object} [params.catalogPrices]   - Optional map: itemName → catalogPrice (number)
 * @returns {Promise<{correctionCount: number, profilesUpdated: string[]}>}
 */
export async function runCorrectionEngine({
    suggestionId,
    restaurantId,
    restaurantName,
    deliveryDay,
    weekStart,
    lines,
    metrics,
    catalogPrices = {},
}) {
    const weekLabel = formatWeekLabel(weekStart);
    const orderDocId = suggestionId || `sug_${restaurantId}_${weekLabel}_${deliveryDay}`;

    // ── STEP 1: Write item-level corrections to forecast/corrections/entries ──────
    const correctionsBatch = writeBatch(db);
    const profilesUpdated = [];

    for (const line of lines) {
        const deltaQty = line.finalQty - (line.rawPrediction ?? line.predictedQty);
        const deltaType = getDeltaType(line.rawPrediction ?? line.predictedQty, line.finalQty);
        const catalogPrice = catalogPrices[line.itemName] || 0;

        const correctionRef = doc(collection(db, 'forecast', 'corrections', 'entries'));

        correctionsBatch.set(correctionRef, {
            correctionId: correctionRef.id,
            restaurantId,
            restaurantName,
            itemId: line.id,
            itemName: line.itemName,
            category: line.category,
            deliveryDay,
            weekStart,
            weekLabel,
            predictedQty: line.rawPrediction ?? line.predictedQty,
            finalQty: line.finalQty,
            deltaQty,
            deltaType,
            packLabel: line.packLabel,
            catalogPrice,
            submittedAt: serverTimestamp(),
            suggestionId: orderDocId,
        });

        profilesUpdated.push(line.itemName);
    }

    await correctionsBatch.commit();

    // ── STEP 2: Write full order to submittedOrders ──────────────────────
    const predictedSpend = lines.reduce(
        (s, l) => s + (l.rawPrediction ?? l.predictedQty) * (catalogPrices[l.itemName] || 0), 0
    );
    const finalSpend = lines.reduce(
        (s, l) => s + l.finalQty * (catalogPrices[l.itemName] || 0), 0
    );

    const orderData = {
        suggestionId: orderDocId,
        restaurantId,
        restaurantName,
        deliveryDay,
        weekStart,
        weekLabel,
        status: 'Submitted',
        submittedAt: serverTimestamp(),
        predictedItemsCount: metrics.predictedActiveCount,
        predictedTotalPacks: metrics.predictedPacks,
        finalItemsCount: metrics.finalActiveCount,
        finalTotalPacks: metrics.finalPacks,
        changesCount: metrics.changesCount,
        netPackDelta: metrics.netDeltaPacks,
        predictionConfidence: metrics.confidence,
        predictedEstimatedSpend: predictedSpend,
        finalEstimatedSpend: finalSpend,
        spendDelta: finalSpend - predictedSpend,
        items: lines.map(l => ({
            itemId: l.id,
            itemName: l.itemName,
            category: l.category,
            packLabel: l.packLabel,
            predictedQty: l.rawPrediction ?? l.predictedQty,
            finalQty: l.finalQty,
            deltaQty: l.finalQty - (l.rawPrediction ?? l.predictedQty),
            deltaType: getDeltaType(l.rawPrediction ?? l.predictedQty, l.finalQty),
            note: l.note || '',
        })),
    };

    await setDoc(doc(db, 'submittedOrders', orderDocId), orderData, { merge: true });

    return {
        correctionCount: lines.length,
        profilesUpdated,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatWeekLabel(weekStart) {
    if (!weekStart) return 'Week Unknown';
    const d = new Date(weekStart);
    if (isNaN(d)) return 'Week Unknown';
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()} – ${end.toLocaleString('default', { month: 'short' })} ${end.getDate()}, ${end.getFullYear()}`;
}
