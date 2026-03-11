import { useMemo } from 'react';

/**
 * MOCK HISTORICAL DATA 
 * Mimics reading from `forecastCorrections` indicating the gap between raw prediction vs final submitted.
 * 
 * Rules:
 * - Onion Cooking: Consistently increased (Predicts 6 -> User submits 7).
 * - French Beans: Consistently reduced (Predicts 2 -> User submits 1).
 * - Tomato: Inconsistent / Low History.
 */
const MOCK_HISTORICAL_EDITS = [
    // Onion Cooking: High Confidence Increase (+1)
    { week: 'W1', itemId: 'i1', itemName: 'Onion - Cooking', predictedQty: 6, finalQty: 7, deltaQty: 1, deltaType: 'Increased' },
    { week: 'W2', itemId: 'i1', itemName: 'Onion - Cooking', predictedQty: 6, finalQty: 7, deltaQty: 1, deltaType: 'Increased' },
    { week: 'W3', itemId: 'i1', itemName: 'Onion - Cooking', predictedQty: 5, finalQty: 6, deltaQty: 1, deltaType: 'Increased' },
    { week: 'W4', itemId: 'i1', itemName: 'Onion - Cooking', predictedQty: 6, finalQty: 7, deltaQty: 1, deltaType: 'Increased' },

    // French Beans: Medium Confidence Reduce (-1)
    { week: 'W2', itemId: 'i3', itemName: 'French Beans', predictedQty: 2, finalQty: 1, deltaQty: -1, deltaType: 'Reduced' },
    { week: 'W3', itemId: 'i3', itemName: 'French Beans', predictedQty: 2, finalQty: 1, deltaQty: -1, deltaType: 'Reduced' },
    { week: 'W4', itemId: 'i3', itemName: 'French Beans', predictedQty: 2, finalQty: 1, deltaQty: -1, deltaType: 'Reduced' },

    // Tomato: Low Confidence / Inconsistent
    { week: 'W3', itemId: 'i2', itemName: 'Tomato', predictedQty: 4, finalQty: 5, deltaQty: 1, deltaType: 'Increased' },
    { week: 'W4', itemId: 'i2', itemName: 'Tomato', predictedQty: 4, finalQty: 2, deltaQty: -2, deltaType: 'Reduced' },

    // Coriander: Unchanged / Stable Base
    { week: 'W1', itemId: 'i4', itemName: 'Coriander Leaves', predictedQty: 10, finalQty: 10, deltaQty: 0, deltaType: 'Unchanged' },
    { week: 'W2', itemId: 'i4', itemName: 'Coriander Leaves', predictedQty: 10, finalQty: 10, deltaQty: 0, deltaType: 'Unchanged' },
    { week: 'W3', itemId: 'i4', itemName: 'Coriander Leaves', predictedQty: 10, finalQty: 10, deltaQty: 0, deltaType: 'Unchanged' },
    { week: 'W4', itemId: 'i4', itemName: 'Coriander Leaves', predictedQty: 10, finalQty: 10, deltaQty: 0, deltaType: 'Unchanged' },
];

/**
 * useCorrectionLearning Hook
 * Analyzes historical edits to derive safe, weighted prediction corrections.
 */
export default function useCorrectionLearning(restaurantId, deliveryDay) {

    const learningProfiles = useMemo(() => {
        // In a real app, query `forecastCorrections` where restaurantId == X and deliveryDay == Y
        const history = MOCK_HISTORICAL_EDITS; // Pretend this was filtered

        // Group edits by Item
        const itemHistory = history.reduce((acc, entry) => {
            if (!acc[entry.itemId]) {
                acc[entry.itemId] = {
                    itemId: entry.itemId,
                    itemName: entry.itemName,
                    edits: []
                };
            }
            acc[entry.itemId].edits.push(entry);
            return acc;
        }, {});

        // Build Correction Profiles
        const profiles = {};

        Object.values(itemHistory).forEach(item => {
            const edits = item.edits;
            const historyCount = edits.length;

            // Rules A: Minimum Learning Threshold (requires 3 or more weeks)
            if (historyCount < 3) {
                profiles[item.itemId] = {
                    itemId: item.itemId,
                    itemName: item.itemName,
                    status: 'Not Enough History',
                    confidence: 'Low',
                    recommendedCorrection: 0
                };
                return;
            }

            const totalDelta = edits.reduce((sum, e) => sum + e.deltaQty, 0);
            const avgDelta = totalDelta / historyCount;

            const increasedCount = edits.filter(e => e.deltaQty > 0).length;
            const reducedCount = edits.filter(e => e.deltaQty < 0).length;
            const unchangedCount = edits.filter(e => e.deltaQty === 0).length;

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

            // Rule B & 7: Confidence Scoring
            let confidence = 'Low';
            if (consistencyRatio >= 0.75 && historyCount >= 4) {
                confidence = 'High';
            } else if (consistencyRatio >= 0.60 && historyCount >= 3) {
                confidence = 'Medium';
            }

            // Rule C: Weighted Correction (Only applying 50% of the average diff, rounded)
            let recommendedCorrection = 0;
            if (confidence === 'High' || confidence === 'Medium') {
                if (directionConsistency === 'Unchanged') {
                    recommendedCorrection = 0;
                } else {
                    // Apply 0.5 weight so we don't swing wildly
                    recommendedCorrection = Math.round(avgDelta * 0.5);
                }
            }

            let status = 'Stable / No Correction Needed';
            if (confidence !== 'Low') {
                if (recommendedCorrection > 0) status = 'Usually Increased';
                if (recommendedCorrection < 0) status = 'Usually Reduced';
            } else if (directionConsistency === 'Mixed') {
                status = 'Volatile / Mixed Behavior';
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
                status
            };
        });

        return profiles;
    }, [restaurantId, deliveryDay]);

    return { learningProfiles };
}
