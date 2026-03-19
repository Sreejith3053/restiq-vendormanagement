/**
 * reviewQueueService.js
 *
 * All Firestore operations for the Superadmin Catalog Review Queue.
 *
 * Top-level collections used (4 only):
 *   catalogReviewQueue/{reviewId}
 *   catalogReviewQueue/{reviewId}/history/{historyId}
 *   catalogItems/{catalogItemId}
 *   vendors/{vendorId}/items/{vendorItemId}
 *   vendors/{vendorId}/items/{vendorItemId}/history/{historyId}
 */

import { db } from '../../firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    setDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    Timestamp,
    deleteField,
    collectionGroup,
} from 'firebase/firestore';
import { normalizeText, normalizePackSize, normalizeUnit } from '../BulkImport/importMatching';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(d);
}

// ── 1. Create a review queue entry ───────────────────────────────────────────

/**
 * createCatalogReviewQueueEntry(params)
 * Called from importFirestore when a row needs admin review.
 *
 * @param {object} params
 *   vendorId, vendorName, vendorItemId, importBatchId, importRowId,
 *   reviewType: "new_item" | "possible_duplicate" | "high_risk_update" | "mapping_review"
 *   proposedData, existingVendorItemData,
 *   suggestedCatalogMatches, suggestedVendorMatches,
 *   matchConfidence, riskFlags, reviewReason,
 *   createdBy (userId or displayName)
 */
export async function createCatalogReviewQueueEntry(params) {
    const {
        vendorId = '', vendorName = '', vendorItemId = '',
        importBatchId = '', importRowId = '',
        reviewType = 'new_item',
        proposedData = {}, existingVendorItemData = {},
        suggestedCatalogMatches = [], suggestedVendorMatches = [],
        matchConfidence = null, riskFlags = [],
        reviewReason = '',
        createdBy = '',
    } = params;

    const ref = await addDoc(collection(db, 'catalogReviewQueue'), {
        reviewType,
        status: 'pending',
        vendorId,
        vendorName,
        vendorItemId,
        importBatchId,
        importRowId,
        source: 'vendor_import',
        proposedData,
        existingVendorItemData,
        suggestedCatalogMatches,
        suggestedVendorMatches,
        matchConfidence: matchConfidence || null,
        riskFlags,
        reviewReason,
        createdAt: serverTimestamp(),
        createdBy,
        reviewedAt: null,
        reviewedBy: null,
        resolutionAction: null,
        resolutionNotes: null,
    });

    return ref.id;
}

// ── 2. Query review queue ──────────────────────────────────────────────────────

/**
 * getPendingCatalogReviewItems(filters)
 * Returns all review items filtered by type, status, vendor, etc.
 * Returns raw Firestore docs as plain objects.
 */
export async function getPendingCatalogReviewItems(filters = {}) {
    const {
        status,       // "pending" | "approved" | "rejected" | "merged" | "held" | null (all)
        reviewType,   // "new_item" | "possible_duplicate" | "high_risk_update" | "mapping_review" | null
        vendorId,     // string | null
        pageSize = 100,
    } = filters;

    let q = collection(db, 'catalogReviewQueue');
    const constraints = [];

    if (status) constraints.push(where('status', '==', status));
    else constraints.push(where('status', 'in', ['pending', 'held']));

    if (reviewType) constraints.push(where('reviewType', '==', reviewType));
    if (vendorId) constraints.push(where('vendorId', '==', vendorId));

    constraints.push(orderBy('createdAt', 'desc'));
    constraints.push(limit(pageSize));

    const snap = await getDocs(query(q, ...constraints));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * getReviewQueueSummary()
 * Returns counts for the summary cards, including unmapped vendor items.
 */
export async function getReviewQueueSummary() {
    const today = todayStart();

    // Parallel queries for each status
    const [pendingSnap, heldSnap, approvedTodaySnap, rejectedTodaySnap] = await Promise.all([
        getDocs(query(collection(db, 'catalogReviewQueue'), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'catalogReviewQueue'), where('status', '==', 'held'))),
        getDocs(query(collection(db, 'catalogReviewQueue'), where('status', '==', 'approved'), where('reviewedAt', '>=', today))),
        getDocs(query(collection(db, 'catalogReviewQueue'), where('status', '==', 'rejected'), where('reviewedAt', '>=', today))),
    ]);

    const pending = pendingSnap.docs.map(d => d.data());

    // Count unmapped vendor items (lightweight — just count, no full data)
    let unmappedCount = 0;
    try {
        const vendorsSnap = await getDocs(collection(db, 'vendors'));
        for (const vDoc of vendorsSnap.docs) {
            const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
            itemSnap.docs.forEach(d => {
                const item = d.data();
                const st = (item.status || item.normalizedStatus || '').toLowerCase();
                if (st === 'merged' || st === 'deleted') return;
                const ms = (item.mappingStatus || '').toLowerCase();
                if (!item.catalogItemId || ms === 'unmapped' || ms === 'pending_review') unmappedCount++;
            });
        }
    } catch (e) {
        console.warn('[getReviewQueueSummary] unmapped count error:', e);
    }

    const counts = {
        totalPending:         pending.length,
        pendingNewItems:      pending.filter(d => d.reviewType === 'new_item').length,
        pendingDuplicates:    pending.filter(d => d.reviewType === 'possible_duplicate').length,
        pendingHighRisk:      pending.filter(d => d.reviewType === 'high_risk_update').length,
        pendingMappingReview: pending.filter(d => d.reviewType === 'mapping_review').length,
        held:                 heldSnap.size,
        approvedToday:        approvedTodaySnap.size,
        rejectedToday:        rejectedTodaySnap.size,
        unmappedVendorItems:  unmappedCount,
    };

    return counts;
}

/**
 * getReviewItemById(reviewId)
 */
export async function getReviewItemById(reviewId) {
    const snap = await getDoc(doc(db, 'catalogReviewQueue', reviewId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

// ── 3. Resolution actions ──────────────────────────────────────────────────────

/**
 * approveAndMapToCatalogItem(reviewId, catalogItemId, { addAlias, aliasName }, reviewerInfo)
 *
 * Maps a vendor item to an existing master catalog item.
 */
export async function approveAndMapToCatalogItem(reviewId, catalogItemId, options = {}, reviewerInfo = {}) {
    const { addAlias = false, aliasName = '' } = options;
    const { userId = '', displayName = '' } = reviewerInfo;

    const reviewSnap = await getDoc(doc(db, 'catalogReviewQueue', reviewId));
    if (!reviewSnap.exists()) throw new Error('Review item not found');
    const review = reviewSnap.data();

    const { vendorId, vendorItemId, proposedData } = review;

    // 1. Update vendor item — set catalogItemId + mappingStatus
    if (vendorItemId) {
        const itemRef = doc(db, 'vendors', vendorId, 'items', vendorItemId);
        await updateDoc(itemRef, {
            catalogItemId,
            mappingStatus: 'mapped',
            updatedAt: serverTimestamp(),
            updatedBy: displayName || userId,
        });
    }

    // 2. Optionally add alias to catalogItem
    if (addAlias && aliasName) {
        await addCatalogAlias(catalogItemId, aliasName);
    }

    // 3. Close review queue item
    await updateDoc(doc(db, 'catalogReviewQueue', reviewId), {
        status: 'approved',
        resolutionAction: 'mapped_to_catalog_item',
        resolutionNotes: `Mapped to catalogItem ${catalogItemId}${addAlias ? ` | Alias added: "${aliasName}"` : ''}`,
        reviewedAt: serverTimestamp(),
        reviewedBy: displayName || userId,
    });

    // 4. Write history — no separate catalogMappingsHistory collection needed
    await writeCatalogReviewHistory(reviewId, {
        action: 'approved_map_to_existing',
        actionBy: displayName || userId,
        notes: `Mapped to catalogItem: ${catalogItemId}${addAlias ? ` | Alias added: "${aliasName}"` : ''}`,
        oldStatus: 'pending',
        newStatus: 'approved',
    });

    return { success: true, catalogItemId };
}

/**
 * approveAndCreateCatalogItem(reviewId, itemData, reviewerInfo)
 *
 * Creates a new master catalog item and maps the vendor item to it.
 */
export async function approveAndCreateCatalogItem(reviewId, itemData, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    const reviewSnap = await getDoc(doc(db, 'catalogReviewQueue', reviewId));
    if (!reviewSnap.exists()) throw new Error('Review item not found');
    const review = reviewSnap.data();

    const { vendorId, vendorItemId, proposedData } = review;

    // 1. Create new catalogItems doc
    const catalogPayload = {
        itemName:          itemData.itemName || proposedData.itemName || '',
        itemNameNormalized: normalizeText(itemData.itemName || proposedData.itemName || ''),
        canonicalName:     itemData.canonicalName || itemData.itemName || proposedData.itemName || '',
        canonicalNameNormalized: normalizeText(itemData.canonicalName || itemData.itemName || proposedData.itemName || ''), // v2
        category:          itemData.category || proposedData.category || '',
        subcategory:       itemData.subcategory || '',
        brand:             itemData.brand || proposedData.brand || '',
        packSize:          itemData.packSize || proposedData.packSize || '',
        packSizeNormalized: normalizePackSize(itemData.packSize || proposedData.packSize || ''),
        baseUnit:          itemData.baseUnit || proposedData.unit || '',
        orderUnit:         itemData.orderUnit || proposedData.unit || '',
        aliases:           itemData.aliases || [],
        status:            'active',
        source:            'superadmin',
        approved:          true,
        createdAt:         serverTimestamp(),
        updatedAt:         serverTimestamp(),
        createdBy:         displayName || userId,
        updatedBy:         displayName || userId,
    };

    const catalogRef = await addDoc(collection(db, 'catalogItems'), catalogPayload);
    const catalogItemId = catalogRef.id;

    // 2. Create/update vendor item and map it
    if (vendorId && proposedData) {
        const vendorItemPayload = {
            vendorId,
            name:              proposedData.itemName || '',
            itemNameNormalized: normalizeText(proposedData.itemName || ''),
            category:          proposedData.category || '',
            brand:             proposedData.brand || '',
            packSize:          proposedData.packSize || '',
            packSizeNormalized: normalizePackSize(proposedData.packSize || ''),
            unit:              proposedData.unit || '',
            unitNormalized:    normalizeUnit(proposedData.unit || ''),
            vendorPrice:       parseFloat(proposedData.price || 0),
            currency:          proposedData.currency || 'CAD',
            vendorSKU:         proposedData.vendorSKU || '',
            status:            proposedData.status || 'Active',
            notes:             proposedData.notes || '',
            catalogItemId,
            mappingStatus:     'mapped',
            sourceLastUpdated: 'import',
            lastImportBatchId: review.importBatchId || '',
            updatedAt:         serverTimestamp(),
            updatedBy:         displayName || userId,
        };

        if (vendorItemId) {
            // Update existing pending vendor item
            await updateDoc(doc(db, 'vendors', vendorId, 'items', vendorItemId), vendorItemPayload);
        } else {
            // No existing item — create it
            vendorItemPayload.createdAt = serverTimestamp();
            vendorItemPayload.createdBy = displayName || userId;
            const newItemRef = await addDoc(collection(db, 'vendors', vendorId, 'items'), vendorItemPayload);
            vendorItemId = newItemRef.id; // update local ref
        }
    }

    // 3. Close review
    await updateDoc(doc(db, 'catalogReviewQueue', reviewId), {
        status: 'approved',
        resolutionAction: 'created_new_catalog_item',
        resolutionNotes: `Created new catalogItem: ${catalogItemId} — "${catalogPayload.canonicalName}"`,
        reviewedAt: serverTimestamp(),
        reviewedBy: displayName || userId,
    });

    await writeCatalogReviewHistory(reviewId, {
        action: 'approved_created_new_catalog_item',
        actionBy: displayName || userId,
        notes: `Created catalogItem: ${catalogItemId}`,
        oldStatus: 'pending', newStatus: 'approved',
    });

    return { success: true, catalogItemId };
}

/**
 * approveHighRiskUpdate(reviewId, notes, reviewerInfo)
 *
 * Admin validates a high-risk update and applies it to the vendor item.
 */
export async function approveHighRiskUpdate(reviewId, notes = '', reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    const reviewSnap = await getDoc(doc(db, 'catalogReviewQueue', reviewId));
    if (!reviewSnap.exists()) throw new Error('Review item not found');
    const review = reviewSnap.data();

    const { vendorId, vendorItemId, proposedData } = review;

    if (vendorId && vendorItemId && proposedData) {
        const updatePayload = {};
        if (proposedData.price !== undefined)   updatePayload.vendorPrice = parseFloat(proposedData.price || 0);
        if (proposedData.packSize !== undefined) { updatePayload.packSize = proposedData.packSize; updatePayload.packSizeNormalized = normalizePackSize(proposedData.packSize); }
        if (proposedData.unit !== undefined)     { updatePayload.unit = proposedData.unit; updatePayload.unitNormalized = normalizeUnit(proposedData.unit); }
        if (proposedData.category !== undefined) updatePayload.category = proposedData.category;
        if (proposedData.brand !== undefined)    updatePayload.brand = proposedData.brand;
        if (proposedData.status !== undefined)   updatePayload.status = proposedData.status;
        if (proposedData.notes !== undefined)    updatePayload.notes = proposedData.notes;
        updatePayload.updatedAt = serverTimestamp();
        updatePayload.updatedBy = displayName || userId;
        updatePayload.sourceLastUpdated = 'import_high_risk_approved';

        await updateDoc(doc(db, 'vendors', vendorId, 'items', vendorItemId), updatePayload);
    }

    await updateDoc(doc(db, 'catalogReviewQueue', reviewId), {
        status: 'approved',
        resolutionAction: 'approved_high_risk_update',
        resolutionNotes: notes || 'High-risk update reviewed and approved by superadmin',
        reviewedAt: serverTimestamp(),
        reviewedBy: displayName || userId,
    });

    await writeCatalogReviewHistory(reviewId, {
        action: 'approved_high_risk_update',
        actionBy: displayName || userId,
        notes: notes || 'Approved by superadmin',
        oldStatus: 'pending', newStatus: 'approved',
    });

    return { success: true };
}

/**
 * mergeWithExistingVendorItem(reviewId, targetVendorItemId, addAlias, reviewerInfo)
 *
 * Used for possible duplicates — merges the proposed item into an existing vendor item.
 */
export async function mergeWithExistingVendorItem(reviewId, targetVendorItemId, addAlias = false, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    const reviewSnap = await getDoc(doc(db, 'catalogReviewQueue', reviewId));
    if (!reviewSnap.exists()) throw new Error('Review item not found');
    const review = reviewSnap.data();

    const { vendorId, vendorItemId, proposedData } = review;

    // Optionally update the target item price if proposed price differs
    if (proposedData?.price) {
        const updatePayload = {
            vendorPrice: parseFloat(proposedData.price),
            updatedAt: serverTimestamp(),
            updatedBy: displayName || userId,
        };
        await updateDoc(doc(db, 'vendors', vendorId, 'items', targetVendorItemId), updatePayload);
    }

    // If the proposed item was already created as a pending vendor item, soft-delete it
    if (vendorItemId && vendorItemId !== targetVendorItemId) {
        await updateDoc(doc(db, 'vendors', vendorId, 'items', vendorItemId), {
            status: 'Merged',
            mergedIntoItemId: targetVendorItemId,
            updatedAt: serverTimestamp(),
            updatedBy: displayName || userId,
        });
    }

    await updateDoc(doc(db, 'catalogReviewQueue', reviewId), {
        status: 'merged',
        resolutionAction: 'merged_into_existing_vendor_item',
        resolutionNotes: `Merged into vendorItemId: ${targetVendorItemId}`,
        reviewedAt: serverTimestamp(),
        reviewedBy: displayName || userId,
    });

    await writeCatalogReviewHistory(reviewId, {
        action: 'merged_into_existing',
        actionBy: displayName || userId,
        notes: `Merged into: ${targetVendorItemId}`,
        oldStatus: 'pending', newStatus: 'merged',
    });

    return { success: true };
}

/**
 * rejectCatalogReviewItem(reviewId, reason, reviewerInfo)
 */
export async function rejectCatalogReviewItem(reviewId, reason = '', reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    await updateDoc(doc(db, 'catalogReviewQueue', reviewId), {
        status: 'rejected',
        resolutionAction: 'rejected',
        resolutionNotes: reason || 'Rejected by superadmin',
        reviewedAt: serverTimestamp(),
        reviewedBy: displayName || userId,
    });

    await writeCatalogReviewHistory(reviewId, {
        action: 'rejected',
        actionBy: displayName || userId,
        notes: reason || 'Rejected',
        oldStatus: 'pending', newStatus: 'rejected',
    });

    return { success: true };
}

/**
 * holdCatalogReviewItem(reviewId, notes, reviewerInfo)
 */
export async function holdCatalogReviewItem(reviewId, notes = '', reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    await updateDoc(doc(db, 'catalogReviewQueue', reviewId), {
        status: 'held',
        resolutionNotes: notes || 'Held for later review',
        reviewedAt: serverTimestamp(),
        reviewedBy: displayName || userId,
    });

    await writeCatalogReviewHistory(reviewId, {
        action: 'held',
        actionBy: displayName || userId,
        notes: notes || 'Held',
        oldStatus: 'pending', newStatus: 'held',
    });
}

// ── 4. Catalog alias management ───────────────────────────────────────────────

/**
 * addCatalogAlias(catalogItemId, alias)
 * Adds an alias string (and its normalized form) to the catalogItem.
 * Stores in both aliases[] and aliasNormalized[] arrays.
 */
export async function addCatalogAlias(catalogItemId, alias) {
    const ref = doc(db, 'catalogItems', catalogItemId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Catalog item not found');

    const data = snap.data();
    const existing = data.aliases || [];
    const existingNorm = data.aliasNormalized || [];
    const raw = (alias || '').trim();
    const normalized = normalizeText(raw);

    if (raw && !existing.includes(raw)) {
        await updateDoc(ref, {
            aliases:         [...existing, raw],
            aliasNormalized: [...existingNorm, normalized],
            updatedAt:       serverTimestamp(),
        });
    }
}

// ── 5. History logging ─────────────────────────────────────────────────────────

/**
 * writeCatalogReviewHistory(reviewId, entry)
 * Writes an action event to catalogReviewQueue/{reviewId}/history subcollection.
 * This is the ONLY history write needed — no separate top-level history collection.
 */
export async function writeCatalogReviewHistory(reviewId, entry) {
    await addDoc(collection(db, 'catalogReviewQueue', reviewId, 'history'), {
        ...entry,
        actionAt: serverTimestamp(),
    });
}

// writeCatalogMappingHistory REMOVED — was writing to a stray catalogMappingsHistory
// top-level collection. All mapping events are now captured inside
// catalogReviewQueue/{reviewId}/history so no extra collection is needed.

/**
 * getReviewHistory(reviewId)
 * Returns the action history for a review item.
 */
export async function getReviewHistory(reviewId) {
    const snap = await getDocs(
        query(
            collection(db, 'catalogReviewQueue', reviewId, 'history'),
            orderBy('actionAt', 'desc')
        )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── 6. Catalog item CRUD ──────────────────────────────────────────────────────

/**
 * getCatalogItems(searchTerm)
 * Returns catalog items for the match suggestion UI.
 */
export async function getCatalogItems(searchTerm = '', limitCount = 20) {
    const snap = await getDocs(
        query(collection(db, 'catalogItems'), where('status', '==', 'active'), limit(limitCount))
    );
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!searchTerm) return all;

    const term = searchTerm.toLowerCase();
    return all.filter(item =>
        (item.canonicalName || item.itemName || '').toLowerCase().includes(term) ||
        (item.aliases || []).some(a => a.toLowerCase().includes(term))
    );
}

/**
 * createCatalogItem(data, reviewerInfo)
 * Direct creation of a master catalog item by admin.
 */
export async function createCatalogItem(data, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;
    const ref = await addDoc(collection(db, 'catalogItems'), {
        itemName:           data.itemName || '',
        itemNameNormalized: normalizeText(data.itemName || ''),
        canonicalName:      data.canonicalName || data.itemName || '',
        canonicalNameNormalized: normalizeText(data.canonicalName || data.itemName || ''), // v2
        category:           data.category || '',
        subcategory:        data.subcategory || '',
        brand:              data.brand || '',
        packSize:           data.packSize || '',
        packSizeNormalized: normalizePackSize(data.packSize || ''),
        baseUnit:           data.baseUnit || '',
        orderUnit:          data.orderUnit || '',
        aliases:            data.aliases || [],
        status:             'active',
        source:             'superadmin',
        approved:           true,
        createdAt:          serverTimestamp(),
        updatedAt:          serverTimestamp(),
        createdBy:          displayName || userId,
        updatedBy:          displayName || userId,
    });
    return ref.id;
}

/**
 * updateCatalogItem(catalogItemId, data, reviewerInfo)
 */
export async function updateCatalogItem(catalogItemId, data, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;
    await updateDoc(doc(db, 'catalogItems', catalogItemId), {
        ...data,
        updatedAt:  serverTimestamp(),
        updatedBy:  displayName || userId,
    });
}

// ── 7. Bulk actions ───────────────────────────────────────────────────────────

/**
 * bulkHoldReviewItems(reviewIds, notes, reviewerInfo)
 */
export async function bulkHoldReviewItems(reviewIds, notes = '', reviewerInfo = {}) {
    await Promise.all(reviewIds.map(id => holdCatalogReviewItem(id, notes, reviewerInfo)));
}

/**
 * bulkRejectReviewItems(reviewIds, reason, reviewerInfo)
 */
export async function bulkRejectReviewItems(reviewIds, reason = '', reviewerInfo = {}) {
    await Promise.all(reviewIds.map(id => rejectCatalogReviewItem(id, reason, reviewerInfo)));
}

// ── 8. Vendor item helpers ────────────────────────────────────────────────────

/**
 * writeVendorItemHistory(vendorId, itemId, entry)
 * Stores a change record in the item's history subcollection.
 */
export async function writeVendorItemHistory(vendorId, itemId, entry) {
    await addDoc(collection(db, 'vendors', vendorId, 'items', itemId, 'history'), {
        ...entry,
        changedAt: serverTimestamp(),
    });
}



// ── 9. Catalog merge ─────────────────────────────────────────────────────────

/**
 * mergeCatalogItems(survivorId, losingId, reviewerInfo)
 *
 * - Moves all aliases from loser into survivor
 * - Remaps all vendor items pointing to losingId → survivorId
 * - Marks loser as mergedInto = survivorId, status = 'merged'
 * - Audit history on survivor
 */
export async function mergeCatalogItems(survivorId, losingId, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;
    if (survivorId === losingId) throw new Error('Cannot merge a catalog item with itself');

    const [survivorSnap, loserSnap] = await Promise.all([
        getDoc(doc(db, 'catalogItems', survivorId)),
        getDoc(doc(db, 'catalogItems', losingId)),
    ]);
    if (!survivorSnap.exists()) throw new Error('Survivor catalog item not found');
    if (!loserSnap.exists()) throw new Error('Losing catalog item not found');

    const survivor = survivorSnap.data();
    const loser = loserSnap.data();

    // 1. Merge aliases
    const mergedAliases = [
        ...new Set([
            ...(survivor.aliases || []),
            ...(loser.aliases || []),
            loser.canonicalName || loser.itemName || '',
        ].filter(Boolean))
    ];
    const mergedAliasNorm = [
        ...new Set([
            ...(survivor.aliasNormalized || []),
            ...(loser.aliasNormalized || []),
            normalizeText(loser.canonicalName || loser.itemName || ''),
        ].filter(Boolean))
    ];

    await updateDoc(doc(db, 'catalogItems', survivorId), {
        aliases:         mergedAliases,
        aliasNormalized: mergedAliasNorm,
        updatedAt:       serverTimestamp(),
        updatedBy:       displayName || userId,
    });

    // 2. Mark loser as merged
    await updateDoc(doc(db, 'catalogItems', losingId), {
        status:     'merged',
        mergedInto: survivorId,
        updatedAt:  serverTimestamp(),
        updatedBy:  displayName || userId,
    });

    // 3. Remap all vendor items pointing to losingId
    const affectedSnap = await getDocs(
        query(collectionGroup(db, 'items'), where('catalogItemId', '==', losingId))
    );
    await Promise.all(
        affectedSnap.docs.map(d =>
            updateDoc(d.ref, {
                catalogItemId: survivorId,
                updatedAt:     serverTimestamp(),
                updatedBy:     displayName || userId,
            })
        )
    );

    // 4. Audit trail on survivor (subcollection)
    await addDoc(collection(db, 'catalogItems', survivorId, 'history'), {
        action:      'merged_from',
        actionBy:    displayName || userId,
        actionAt:    serverTimestamp(),
        notes:       `Merged from catalogItemId: ${losingId} ("${loser.canonicalName || loser.itemName}"). ${affectedSnap.size} vendor items remapped.`,
        losingItemId: losingId,
        vendorItemsRemapped: affectedSnap.size,
    });

    return { success: true, vendorItemsRemapped: affectedSnap.size };
}

// ── 8. Revert an accidental mapping ───────────────────────────────────────────

/**
 * revertCatalogMapping(reviewId, reviewerInfo)
 *
 * Undoes an "approved - mapped_to_catalog_item" action:
 * 1. Clears catalogItemId from the vendor item
 * 2. Resets the vendor item's mappingStatus to 'unmapped'
 * 3. Resets the review queue item back to 'pending'
 * 4. Writes a history entry
 */
export async function revertCatalogMapping(reviewId, reason = '', reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    const reviewSnap = await getDoc(doc(db, 'catalogReviewQueue', reviewId));
    if (!reviewSnap.exists()) throw new Error('Review item not found');
    const review = reviewSnap.data();

    const { vendorId, vendorItemId } = review;

    // 1. Clear the catalog mapping from the vendor item
    if (vendorId && vendorItemId) {
        const itemRef = doc(db, 'vendors', vendorId, 'items', vendorItemId);
        const itemSnap = await getDoc(itemRef);
        if (itemSnap.exists()) {
            await updateDoc(itemRef, {
                catalogItemId: deleteField(),
                mappingStatus: 'unmapped',
                updatedAt: serverTimestamp(),
                updatedBy: displayName || userId,
            });
        }
    }

    // 2. Reset review queue item to pending
    await updateDoc(doc(db, 'catalogReviewQueue', reviewId), {
        status: 'pending',
        resolutionAction: null,
        resolutionNotes: reason || 'Mapping reverted by superadmin',
        reviewedAt: null,
        reviewedBy: null,
    });

    // 3. Write history
    await writeCatalogReviewHistory(reviewId, {
        action: 'reverted_mapping',
        actionBy: displayName || userId,
        notes: reason || 'Accidentally mapped — reverted to pending',
        oldStatus: review.status || 'approved',
        newStatus: 'pending',
    });

    return { success: true };
}



// ── 10. Vendor Details → Review Queue integration ───────────────────────────

/**
 * getOpenReviewRecordForItem(vendorItemId)
 * Returns first open (pending|held) queue record for the given vendorItemId, or null.
 * Used to show "In Review" badge and deduplicate Send-to-Review calls.
 */
export async function getOpenReviewRecordForItem(vendorItemId) {
    if (!vendorItemId) return null;
    const snap = await getDocs(
        query(
            collection(db, 'catalogReviewQueue'),
            where('vendorItemId', '==', vendorItemId),
            where('status', 'in', ['pending', 'held']),
            limit(1),
        )
    );
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * sendVendorItemToReviewQueue(params)
 *
 * Dedup-safe Send to Review from Vendor Details page.
 * Creates a new catalogReviewQueue record or updates an existing open one.
 * Transitions vendor item status from active => review_flagged.
 *
 * @param params.vendorId, vendorName, vendorItemId
 * @param params.item         enriched item from VendorDetailPage (_packSize, _baseUnit, etc.)
 * @param params.issueFlags   string[] e.g. ['suspect_entry', 'possible_alias']
 * @param params.primaryReason string e.g. 'suspect_entry'
 * @param params.reviewedBy   { userId, displayName }
 * @returns { reviewId: string, isUpdate: boolean }
 */
export async function sendVendorItemToReviewQueue(params) {
    const {
        vendorId     = '',
        vendorName   = '',
        vendorItemId = '',
        item         = {},
        issueFlags   = [],
        primaryReason = 'data_quality',
        reviewedBy   = {},
    } = params;

    const actor      = reviewedBy.displayName || reviewedBy.userId || 'system';
    const reviewType =
        issueFlags.includes('possible_alias') ? 'possible_duplicate' :
        issueFlags.includes('unmapped_item')  ? 'mapping_review'     :
        'data_quality';

    const proposedData = {
        itemName:            item.itemName || item.name || '',
        category:            item.category || '',
        unit:                item.unit || item.baseUnit || '',
        itemSize:            item.itemSize || '',
        packQuantity:        item.packQuantity ?? null,
        parsedPackSize:      item._packSize ?? null,
        parsedBaseUnit:      item._baseUnit ?? null,
        price:               item.vendorPrice ?? item.price ?? 0,
        normalizedUnitPrice: item._pricePerBaseUnit ?? null,
        currentStatus:       item.status || item.normalizedStatus || '',
        normalizedPossible:  item._normalizedPossible || false,
        catalogItemId:       item.catalogItemId || null,
    };

    const riskFlags = [...new Set(issueFlags)];

    // ── Deduplication: update if an open record already exists ──
    const existing = await getOpenReviewRecordForItem(vendorItemId);
    if (existing) {
        const merged = [...new Set([...(existing.riskFlags || []), ...riskFlags])];
        await updateDoc(doc(db, 'catalogReviewQueue', existing.id), {
            riskFlags: merged, reviewReason: primaryReason, proposedData,
            updatedAt: serverTimestamp(), updatedBy: actor, source: 'vendor_details',
        });
        await writeCatalogReviewHistory(existing.id, {
            action: 'review_flags_updated', actionBy: actor,
            notes: 'Re-sent from Vendor Details. Flags: ' + riskFlags.join(', '),
            oldStatus: existing.status, newStatus: existing.status,
        });
        return { reviewId: existing.id, isUpdate: true };
    }

    // ── Create new queue record ──
    const ref = await addDoc(collection(db, 'catalogReviewQueue'), {
        reviewType, status: 'pending', source: 'vendor_details',
        vendorId, vendorName, vendorItemId,
        importBatchId: '', importRowId: '',
        proposedData, existingVendorItemData: proposedData,
        suggestedCatalogMatches: [], suggestedVendorMatches: [],
        matchConfidence: null, riskFlags, reviewReason: primaryReason,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: actor, updatedBy: actor,
        reviewedAt: null, reviewedBy: null,
        resolutionAction: null, resolutionNotes: null,
    });

    await writeCatalogReviewHistory(ref.id, {
        action: 'created_from_vendor_details', actionBy: actor,
        notes: 'Sent to review queue. Flags: ' + riskFlags.join(', '),
        oldStatus: null, newStatus: 'pending',
    });

    // ── Transition vendor item to review_flagged if currently active ──
    const s1 = (item.normalizedStatus || '').toLowerCase();
    const s2 = (item.status || '').toLowerCase();
    if (s1 === 'active' || s2 === 'active') {
        await updateDoc(doc(db, 'vendors', vendorId, 'items', vendorItemId), {
            status: 'review_flagged', normalizedStatus: 'review_flagged',
            reviewQueueId: ref.id, flaggedAt: serverTimestamp(), flaggedBy: actor,
        });
    }

    return { reviewId: ref.id, isUpdate: false };
}

// ── 11. Unmapped Vendor Items ──────────────────────────────────────────────────

/**
 * getUnmappedVendorItems(filters)
 * Scans vendors/{vendorId}/items for items without catalogItemId
 * or with mappingStatus = unmapped/pending_review.
 *
 * Returns array of { vendorId, vendorName, itemId, itemName, price, unit, category, status, packSize, mappingStatus }
 */
export async function getUnmappedVendorItems(filters = {}) {
    const { vendorId: filterVendorId, category: filterCategory } = filters;

    const vendorsSnap = await getDocs(collection(db, 'vendors'));
    const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const results = [];

    for (const v of vendors) {
        if (filterVendorId && v.id !== filterVendorId) continue;

        try {
            const itemSnap = await getDocs(collection(db, `vendors/${v.id}/items`));
            itemSnap.docs.forEach(d => {
                const item = d.data();
                const mappingStatus = (item.mappingStatus || '').toLowerCase();
                const hasCatalogId = !!item.catalogItemId;
                const itemStatus = (item.status || item.normalizedStatus || '').toLowerCase();

                // Skip merged/deleted items
                if (itemStatus === 'merged' || itemStatus === 'deleted') return;

                // Only include unmapped items
                const isUnmapped = !hasCatalogId || mappingStatus === 'unmapped' || mappingStatus === 'pending_review';
                if (!isUnmapped) return;

                // Category filter
                const itemCategory = (item.category || '').toLowerCase();
                if (filterCategory && itemCategory !== filterCategory.toLowerCase()) return;

                results.push({
                    vendorId: v.id,
                    vendorName: v.name || v.businessName || 'Unknown Vendor',
                    itemId: d.id,
                    itemName: item.itemName || item.name || '(unnamed)',
                    price: parseFloat(item.vendorPrice) || parseFloat(item.price) || 0,
                    unit: item.unit || item.baseUnit || '',
                    category: item.category || '',
                    status: item.status || item.normalizedStatus || '',
                    packSize: item.packSize || item.itemSize || '',
                    mappingStatus: item.mappingStatus || (hasCatalogId ? 'mapped' : 'unmapped'),
                    catalogItemId: item.catalogItemId || null,
                });
            });
        } catch (e) {
            console.warn(`[getUnmappedVendorItems] Error reading vendor ${v.id}:`, e);
        }
    }

    return results;
}

/**
 * getVendorList()
 * Returns all vendors for filter dropdowns: { id, name, category }
 */
export async function getVendorList() {
    const snap = await getDocs(collection(db, 'vendors'));
    return snap.docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            name: data.name || data.businessName || 'Unknown',
            category: data.category || '',
        };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * mapUnmappedVendorItem(vendorId, itemId, catalogItemId, reviewerInfo)
 * Directly maps an unmapped vendor item to a catalog item from the Unmapped Items tab.
 */
export async function mapUnmappedVendorItem(vendorId, itemId, catalogItemId, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    const itemRef = doc(db, 'vendors', vendorId, 'items', itemId);
    await updateDoc(itemRef, {
        catalogItemId,
        mappingStatus: 'mapped',
        mappingSource: 'review_approved',
        updatedAt: serverTimestamp(),
        updatedBy: displayName || userId,
    });

    // Write vendor item history
    await addDoc(collection(db, 'vendors', vendorId, 'items', itemId, 'history'), {
        action: 'mapped_from_review_queue',
        actionBy: displayName || userId,
        actionAt: serverTimestamp(),
        notes: `Mapped to catalogItemId: ${catalogItemId} from Unmapped Items tab`,
        catalogItemId,
    });

    return { success: true };
}

