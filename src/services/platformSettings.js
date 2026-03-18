/**
 * platformSettings.js
 *
 * Service for reading and writing platform-wide configuration.
 * Stored under platformSettings/{docId} top-level collection.
 *
 * Documents:
 *   platformSettings/catalogMatching  — matching engine weights & thresholds
 *   platformSettings/importRules      — import behavior & classification rules
 */
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// ── Defaults ──────────────────────────────────────────────────────────────────

const CATALOG_MATCHING_DEFAULTS = {
    exactNameWeight:           10.0,
    normalizedNameWeight:       8.0,
    aliasWeight:                7.0,
    categoryWeight:             2.0,
    packSizeWeight:             3.0,
    unitWeight:                 1.5,
    priorMappingWeight:         5.0,
    duplicateThreshold:         0.85,  // score above which → possible duplicate
    reviewThreshold:            0.55,  // score above → needs_review candidate
    autoMatchThreshold:         0.90,  // score above → auto update
    autoAddAliasOnApprovedReview: true,
    allowPluralSingularEquivalence: true,
    allowProduceVariants:       true,
    updatedAt:                  null,
};

const IMPORT_RULES_DEFAULTS = {
    autoApplyRecommendedReview:     false,
    highRiskThresholdPercent:        50,   // price change > 50% → high risk
    duplicateSimilarityThreshold:    0.90,
    requireReviewForAllNewItems:     false,
    defaultReviewBehavior:           'queue', // 'queue' | 'auto_approve'
    updatedAt:                       null,
};

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * getPlatformSettings(docId)
 * Reads a settings document. Returns defaults if not yet written.
 * @param {'catalogMatching' | 'importRules'} docId
 */
export async function getPlatformSettings(docId) {
    const defaults = docId === 'catalogMatching'
        ? CATALOG_MATCHING_DEFAULTS
        : IMPORT_RULES_DEFAULTS;

    try {
        const snap = await getDoc(doc(db, 'platformSettings', docId));
        if (snap.exists()) {
            return { ...defaults, ...snap.data() };
        }
        return defaults;
    } catch (err) {
        console.warn(`[platformSettings] Could not read ${docId}:`, err);
        return defaults;
    }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * updatePlatformSettings(docId, data, reviewerInfo)
 * Merges partial data into the settings document. Creates if not exists.
 */
export async function updatePlatformSettings(docId, data, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;
    await setDoc(
        doc(db, 'platformSettings', docId),
        {
            ...data,
            updatedAt: serverTimestamp(),
            updatedBy: displayName || userId,
        },
        { merge: true }
    );
}

/**
 * seedPlatformSettingsDefaults()
 * One-time seed: writes defaults if documents don't exist yet.
 */
export async function seedPlatformSettingsDefaults() {
    for (const [docId, defaults] of Object.entries({
        catalogMatching: CATALOG_MATCHING_DEFAULTS,
        importRules:     IMPORT_RULES_DEFAULTS,
    })) {
        const snap = await getDoc(doc(db, 'platformSettings', docId));
        if (!snap.exists()) {
            await setDoc(doc(db, 'platformSettings', docId), {
                ...defaults,
                updatedAt: serverTimestamp(),
            });
            console.log(`[platformSettings] Seeded defaults for: ${docId}`);
        }
    }
}
