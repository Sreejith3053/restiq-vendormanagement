/**
 * vendorCatalogService.js
 *
 * Standard CRUD service for vendor catalog items.
 * Uses the reduced 4-collection architecture:
 *   vendors/{vendorId}/items/{itemId}
 *   vendors/{vendorId}/items/{itemId}/history/{historyId}
 *   catalogItems/{catalogItemId}
 */
import { db } from '../firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    deleteField,
} from 'firebase/firestore';

// ── Normalize helpers ─────────────────────────────────────────────────────────
function normalizeStr(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// ── Vendor Item CRUD ──────────────────────────────────────────────────────────

/**
 * getVendorItems(vendorId, filters)
 * Returns vendor items optionally filtered by mappingStatus or category.
 */
export async function getVendorItems(vendorId, filters = {}) {
    const { mappingStatus, category, status, pageSize = 500 } = filters;
    const constraints = [];
    if (mappingStatus) constraints.push(where('mappingStatus', '==', mappingStatus));
    if (category)     constraints.push(where('category', '==', category));
    if (status)       constraints.push(where('status', '==', status));
    constraints.push(orderBy('itemName'));
    constraints.push(limit(pageSize));

    const snap = await getDocs(
        query(collection(db, 'vendors', vendorId, 'items'), ...constraints)
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * getVendorItem(vendorId, itemId)
 */
export async function getVendorItem(vendorId, itemId) {
    const snap = await getDoc(doc(db, 'vendors', vendorId, 'items', itemId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

/**
 * createVendorItem(vendorId, data, reviewerInfo)
 * Creates a new vendor item and writes a history entry.
 */
export async function createVendorItem(vendorId, data, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;
    const rawStatus = data.status || 'Active';

    // Phase 3: write ONLY v2 canonical fields — no `name`, `price`, `unit` legacy writes
    const baseUnit  = data.baseUnit  || normalizeStr(data.unit || '');
    const orderUnit = data.orderUnit || data.baseUnit || data.unit || '';

    const payload = {
        vendorId,
        itemName:           data.itemName || '',
        itemNameNormalized: normalizeStr(data.itemName || ''),
        vendorSKU:          data.vendorSKU || '',
        category:           data.category || '',
        brand:              data.brand || '',
        packSize:           data.packSize || '',
        packSizeNormalized: normalizeStr(data.packSize || ''),
        baseUnit,
        orderUnit,
        vendorPrice:        parseFloat(data.vendorPrice ?? data.price) || 0,  // v2 first
        currency:           data.currency || 'CAD',
        minOrderQty:        data.minOrderQty || '',
        leadTimeDays:       data.leadTimeDays || '',
        status:             rawStatus,
        normalizedStatus:   rawStatus.toLowerCase(),
        notes:              data.notes || '',
        catalogItemId:      data.catalogItemId || null,
        mappingStatus:      data.catalogItemId ? 'mapped' : (data.mappingStatus || 'unmapped'),
        mappingConfidence:  data.mappingConfidence || null,
        mappingSource:      data.mappingSource || null,
        sourceLastUpdated:  data.sourceLastUpdated || 'manual',
        lastImportBatchId:  data.lastImportBatchId || null,
        createdAt:          serverTimestamp(),
        updatedAt:          serverTimestamp(),
        createdBy:          displayName || userId,
        updatedBy:          displayName || userId,
    };

    const ref = await addDoc(collection(db, 'vendors', vendorId, 'items'), payload);

    await writeVendorItemHistory(vendorId, ref.id, {
        changedBy:    displayName || userId,
        changeSource: 'manual',
        newValues:    payload,
        changedFields: ['created'],
        notes:        'Item created',
    });

    return ref.id;
}

/**
 * updateVendorItem(vendorId, itemId, data, reviewerInfo)
 * Updates a vendor item and writes a diff history entry.
 */
export async function updateVendorItem(vendorId, itemId, data, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    const oldSnap = await getDoc(doc(db, 'vendors', vendorId, 'items', itemId));
    const oldData = oldSnap.exists() ? oldSnap.data() : {};

    const update = {
        ...data,
        updatedAt: serverTimestamp(),
        updatedBy: displayName || userId,
    };

    // Normalize itemName when included
    if (data.itemName !== undefined) {
        update.itemNameNormalized = normalizeStr(data.itemName);
    }
    // Phase 3: derive packSizeNormalized when packSize changes
    if (data.packSize !== undefined) {
        update.packSizeNormalized = normalizeStr(data.packSize);
    }
    // v2: normalize status
    if (data.status !== undefined) {
        update.normalizedStatus = (data.status || '').toLowerCase();
    }
    // v2: ensure vendorPrice is always set (flip price→vendorPrice)
    if (data.price !== undefined && data.vendorPrice === undefined) {
        update.vendorPrice = parseFloat(data.price) || 0;
        delete update.price; // stop writing legacy price field
    }
    // v2: derive baseUnit/orderUnit if only the legacy `unit` field was passed
    if (data.unit !== undefined && data.baseUnit === undefined) {
        update.baseUnit  = normalizeStr(data.unit);
        update.orderUnit = update.orderUnit || data.unit;
        delete update.unit; // stop writing legacy unit field
    }

    await updateDoc(doc(db, 'vendors', vendorId, 'items', itemId), update);

    const changedFields = Object.keys(data).filter(k => data[k] !== oldData[k]);
    const oldValues = {};
    changedFields.forEach(k => { oldValues[k] = oldData[k]; });

    await writeVendorItemHistory(vendorId, itemId, {
        changedBy:    displayName || userId,
        changeSource: 'manual',
        oldValues,
        newValues:    data,
        changedFields,
        notes:        '',
    });
}

/**
 * unmapVendorItem(vendorId, itemId, reviewerInfo)
 * Clears the catalogItemId and resets mappingStatus to unmapped.
 */
export async function unmapVendorItem(vendorId, itemId, reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    await updateDoc(doc(db, 'vendors', vendorId, 'items', itemId), {
        catalogItemId:     deleteField(),
        mappingStatus:     'unmapped',
        mappingConfidence: deleteField(),
        mappingSource:     deleteField(),
        updatedAt:         serverTimestamp(),
        updatedBy:         displayName || userId,
    });

    await writeVendorItemHistory(vendorId, itemId, {
        changedBy:    displayName || userId,
        changeSource: 'manual',
        changedFields: ['catalogItemId', 'mappingStatus'],
        notes:        'Mapping reverted',
    });
}

// ── History ───────────────────────────────────────────────────────────────────

/**
 * writeVendorItemHistory(vendorId, itemId, entry)
 */
export async function writeVendorItemHistory(vendorId, itemId, entry) {
    await addDoc(collection(db, 'vendors', vendorId, 'items', itemId, 'history'), {
        ...entry,
        changedAt: serverTimestamp(),
    });
}

/**
 * getVendorItemHistory(vendorId, itemId)
 */
export async function getVendorItemHistory(vendorId, itemId) {
    const snap = await getDocs(
        query(
            collection(db, 'vendors', vendorId, 'items', itemId, 'history'),
            orderBy('changedAt', 'desc'),
            limit(50)
        )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
