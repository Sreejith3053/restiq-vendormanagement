import { useState, useEffect, useMemo } from 'react';
import { fetchCorrectionHistory, computeCorrectionProfiles } from './forecastHelpers';

/**
 * useCorrectionLearning Hook
 *
 * Reads real correction data from Firestore `correctionEntries` collection
 * and computes learning profiles for display in the sidebar.
 *
 * This hook is used ONLY for UI display (Learning Insights sidebar).
 * The actual corrections are applied inside buildRestaurantForecast() in forecastHelpers.js.
 */
export default function useCorrectionLearning(restaurantId, deliveryDay) {
    const [corrections, setCorrections] = useState([]);
    const [loading, setLoading] = useState(true);

    // Fetch corrections from Firestore whenever restaurant or delivery day changes
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const data = await fetchCorrectionHistory(restaurantId, deliveryDay);
                if (!cancelled) {
                    setCorrections(data);
                }
            } catch (err) {
                console.warn('[CorrectionLearning] Fetch failed:', err.message);
                if (!cancelled) setCorrections([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        if (restaurantId) {
            load();
        } else {
            setCorrections([]);
            setLoading(false);
        }

        return () => { cancelled = true; };
    }, [restaurantId, deliveryDay]);

    // Compute profiles from raw corrections
    const learningProfiles = useMemo(() => {
        return computeCorrectionProfiles(corrections);
    }, [corrections]);

    // Compute summary insights for the sidebar
    const insights = useMemo(() => {
        if (corrections.length === 0) {
            return {
                hasData: false,
                totalCorrections: 0,
                lastWeekAccuracy: null,
                mostEditedItem: null,
                consistentlyReduced: null,
                consistentlyIncreased: null,
                activeLearnedCount: 0,
            };
        }

        // Group corrections by week to find last week's accuracy
        const weekGroups = {};
        corrections.forEach(c => {
            const week = c.weekLabel || c.weekStart || 'unknown';
            if (!weekGroups[week]) weekGroups[week] = [];
            weekGroups[week].push(c);
        });

        const weekKeys = Object.keys(weekGroups).sort().reverse();
        const lastWeekCorrections = weekKeys.length > 0 ? weekGroups[weekKeys[0]] : [];

        let lastWeekAccuracy = null;
        if (lastWeekCorrections.length > 0) {
            const unchangedCount = lastWeekCorrections.filter(c => c.deltaType === 'Unchanged').length;
            lastWeekAccuracy = Math.round((unchangedCount / lastWeekCorrections.length) * 100);
        }

        // Most edited item (highest edit frequency)
        const editCounts = {};
        corrections.forEach(c => {
            if (c.deltaType !== 'Unchanged') {
                editCounts[c.itemName] = (editCounts[c.itemName] || 0) + 1;
            }
        });
        const mostEditedItem = Object.entries(editCounts)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        // Find consistently reduced and increased items from profiles
        let consistentlyReduced = null;
        let consistentlyIncreased = null;
        Object.values(learningProfiles).forEach(p => {
            if (p.directionConsistency === 'Reduced' && p.confidence !== 'Low' && !consistentlyReduced) {
                consistentlyReduced = p.itemName;
            }
            if (p.directionConsistency === 'Increased' && p.confidence !== 'Low' && !consistentlyIncreased) {
                consistentlyIncreased = p.itemName;
            }
        });

        const activeLearnedCount = Object.values(learningProfiles)
            .filter(p => p.confidence === 'High' || p.confidence === 'Medium').length;

        return {
            hasData: true,
            totalCorrections: corrections.length,
            lastWeekAccuracy,
            mostEditedItem,
            consistentlyReduced,
            consistentlyIncreased,
            activeLearnedCount,
        };
    }, [corrections, learningProfiles]);

    return { learningProfiles, insights, loading };
}
