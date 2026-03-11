/**
 * forecastCorrectionEngine.js
 *
 * Automatic comparison and learning engine for RestIQ Solutions.
 *
 * Fired automatically once when a restaurant submits their final order.
 * No manual trigger or AI prompt required.
 *
 * Sequence (per spec):
 *  1. Save order snapshot to `suggestedOrders`
 *  2. Write item-level correction rows to `forecastCorrections`
 *  3. Calculate and write order summary deltas
 *  4. Read recent correction history per restaurant+item+deliveryDay
 *  5. Recalculate and upsert `forecastCorrectionProfiles`
 *  6. Write record to `submittedOrders` for super-admin Order Planning view
 *
 * Collections:
 *  - suggestedOrders
 *  - forecastCorrections
 *  - forecastCorrectionProfiles
 *  - submittedOrders
 */

import { db } from '../../firebase';
import {
    collection,
    doc,
    setDoc,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
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

// ── Direction consistency label ──────────────────────────────────────────────
function calcDirectionConsistency(positiveCount, negativeCount, unchangedCount) {
    const total = positiveCount + negativeCount + unchangedCount;
    if (total === 0) return 'Unknown';
    const maxCount = Math.max(positiveCount, negativeCount, unchangedCount);
    const ratio = maxCount / total;
    if (positiveCount >= negativeCount && positiveCount >= unchangedCount) {
        return ratio >= 0.75 ? 'Consistently Increased' : 'Usually Increased';
    }
    if (negativeCount >= positiveCount && negativeCount >= unchangedCount) {
        return ratio >= 0.75 ? 'Consistently Reduced' : 'Usually Reduced';
    }
    return 'Mixed';
}

// ── Confidence label based on edit frequency and direction ───────────────────
function calcConfidenceLabel(editFreqLast4, directConsistency, historyCount) {
    if (historyCount < 3) return 'Low';
    if (editFreqLast4 >= 0.75 &&
        (directConsistency === 'Consistently Increased' || directConsistency === 'Consistently Reduced')) {
        return 'High';
    }
    if (editFreqLast4 >= 0.5) return 'Medium';
    return 'Low';
}

// ── Learning status label ────────────────────────────────────────────────────
function calcLearningStatus(historyCount, confidence, avgDeltaLast4) {
    if (historyCount < 3) return 'Not Enough History';
    if (Math.abs(avgDeltaLast4) < 0.5) return 'No Correction Needed';
    if (confidence === 'High') return 'Stable';
    return 'Learning Active';
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
 *                                                        predictedQty, finalQty, deltaQty,
 *                                                        deltaType, note }
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
    const submittedAt = new Date();
    const weekLabel = formatWeekLabel(weekStart);

    // ── STEP 1: Upsert suggestedOrders record ──────────────────────────────
    const orderDocId = suggestionId || `sug_${restaurantId}_${weekLabel}_${deliveryDay}`;

    const suggestedOrderData = {
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
        items: lines.map(l => ({
            itemId: l.id,
            itemName: l.itemName,
            category: l.category,
            packLabel: l.packLabel,
            predictedQty: l.predictedQty,
            finalQty: l.finalQty,
            deltaQty: l.finalQty - l.predictedQty,
            deltaType: getDeltaType(l.predictedQty, l.finalQty),
            note: l.note || '',
        })),
    };

    await setDoc(doc(db, 'suggestedOrders', orderDocId), suggestedOrderData, { merge: true });

    // ── STEP 2: Write item-level correction rows to forecastCorrections ──────
    const correctionsBatch = writeBatch(db);
    const correctionIds = [];

    for (const line of lines) {
        const deltaQty = line.finalQty - line.predictedQty;
        const deltaType = getDeltaType(line.predictedQty, line.finalQty);
        const catalogPrice = catalogPrices[line.itemName] || 0;

        const correctionRef = doc(collection(db, 'forecastCorrections'));
        correctionIds.push(correctionRef.id);

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
            predictedQty: line.predictedQty,
            finalQty: line.finalQty,
            deltaQty,
            deltaType,
            packLabel: line.packLabel,
            catalogPrice,
            submittedAt: serverTimestamp(),
            suggestionId: orderDocId,
        });
    }

    await correctionsBatch.commit();

    // ── STEP 3: Order-level summary deltas ────────────────────────────────
    const predictedSpend = lines.reduce(
        (s, l) => s + l.predictedQty * (catalogPrices[l.itemName] || 0), 0
    );
    const finalSpend = lines.reduce(
        (s, l) => s + l.finalQty * (catalogPrices[l.itemName] || 0), 0
    );

    const orderSummaryRef = doc(collection(db, 'forecastOrderSummaries'));
    await setDoc(orderSummaryRef, {
        restaurantId,
        restaurantName,
        deliveryDay,
        weekStart,
        weekLabel,
        predictedItemsCount: metrics.predictedActiveCount,
        finalItemsCount: metrics.finalActiveCount,
        predictedTotalPacks: metrics.predictedPacks,
        finalTotalPacks: metrics.finalPacks,
        changesCount: metrics.changesCount,
        netPackDelta: metrics.netDeltaPacks,
        predictedEstimatedSpend: predictedSpend,
        finalEstimatedSpend: finalSpend,
        spendDelta: finalSpend - predictedSpend,
        submittedAt: serverTimestamp(),
        suggestionId: orderDocId,
    });

    // ── STEP 4 & 5: Update forecastCorrectionProfiles per item ───────────
    const profilesUpdated = [];

    for (const line of lines) {
        const profileKey = `${restaurantId}__${line.id}__${deliveryDay}`;

        // Fetch recent correction history for this restaurant+item+deliveryDay
        const historySnap = await getDocs(
            query(
                collection(db, 'forecastCorrections'),
                where('restaurantId', '==', restaurantId),
                where('itemId', '==', line.id),
                where('deliveryDay', '==', deliveryDay),
                orderBy('submittedAt', 'desc'),
                limit(8)
            )
        );

        const history = historySnap.docs.map(d => d.data());
        const histCount = history.length;

        const last4 = history.slice(0, 4);
        const last8 = history.slice(0, 8);

        const avgDeltaLast4 = last4.length > 0
            ? last4.reduce((s, h) => s + (h.deltaQty || 0), 0) / last4.length
            : 0;
        const avgDeltaLast8 = last8.length > 0
            ? last8.reduce((s, h) => s + (h.deltaQty || 0), 0) / last8.length
            : 0;

        const editedLast4 = last4.filter(h => h.deltaType !== 'Unchanged').length;
        const editedLast8 = last8.filter(h => h.deltaType !== 'Unchanged').length;

        const editFreqLast4 = last4.length > 0 ? editedLast4 / last4.length : 0;
        const editFreqLast8 = last8.length > 0 ? editedLast8 / last8.length : 0;

        const posCount = history.filter(h => (h.deltaQty || 0) > 0).length;
        const negCount = history.filter(h => (h.deltaQty || 0) < 0).length;
        const unchangedCount = history.filter(h => h.deltaType === 'Unchanged').length;

        const directionConsistency = calcDirectionConsistency(posCount, negCount, unchangedCount);
        const confidence = calcConfidenceLabel(editFreqLast4, directionConsistency, histCount);
        const learningStatus = calcLearningStatus(histCount, confidence, avgDeltaLast4);

        // Recommended correction: round to nearest integer, only if confidence is High or Medium
        const rawRecommendedCorrection = confidence === 'High' || confidence === 'Medium'
            ? Math.round(avgDeltaLast4)
            : 0;

        await setDoc(doc(db, 'forecastCorrectionProfiles', profileKey), {
            profileKey,
            restaurantId,
            restaurantName,
            itemId: line.id,
            itemName: line.itemName,
            category: line.category,
            deliveryDay,
            avgDeltaLast4: parseFloat(avgDeltaLast4.toFixed(2)),
            avgDeltaLast8: parseFloat(avgDeltaLast8.toFixed(2)),
            editFrequencyLast4: parseFloat(editFreqLast4.toFixed(2)),
            editFrequencyLast8: parseFloat(editFreqLast8.toFixed(2)),
            positiveDeltaCount: posCount,
            negativeDeltaCount: negCount,
            unchangedCount,
            historyCount: histCount,
            directionConsistency,
            learnedCorrectionConfidence: confidence,
            learningStatus,
            recommendedCorrection: rawRecommendedCorrection,
            updatedAt: serverTimestamp(),
        }, { merge: true });

        profilesUpdated.push(line.itemName);
    }

    // ── STEP 6: Write to submittedOrders for super-admin Order Planning ────
    const submitRef = doc(db, 'submittedOrders', orderDocId);
    await setDoc(submitRef, {
        ...suggestedOrderData,
        // override submittedAt to a real timestamp
        submittedAt: serverTimestamp(),
        // keep sub-status as Submitted for pipeline tracking
        status: 'Submitted',
        weekLabel,
        // metrics summary for display
        predictedEstimatedSpend: predictedSpend,
        finalEstimatedSpend: finalSpend,
        spendDelta: finalSpend - predictedSpend,
    }, { merge: true });

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
