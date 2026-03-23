/**
 * changeRequestService.js
 *
 * ════════════════════════════════════════════════════════════════
 * OFFICIAL REVIEW WORKFLOW — uses `changeRequests` collection ONLY
 * ════════════════════════════════════════════════════════════════
 *
 * `catalogReviewQueue` is DEPRECATED. Do not read or write to it anywhere
 * in active app logic. All review operations must go through this service.
 *
 * Document structure for `changeRequests`:
 *   requestType: "NEW_ITEM" | "EDIT" | "DELETE" | "DEACTIVATE" | "MAPPING"
 *   status:      "PENDING"  | "HELD" | "APPROVED" | "REJECTED"
 *   vendorId, vendorName, vendorItemId
 *   catalogItemId (nullable)
 *   itemName, category, unit, packSize, price, taxRate
 *   createdAt, updatedAt, resolvedAt, resolvedBy
 *   notes / reason (nullable)
 *   source: "IMPORT" | "VENDOR_EDIT" | "ADMIN_CREATE" | "MAPPING_FIX"
 *   proposedData (full proposed fields from import/edit)
 */

import { db } from '../firebase';
import {
    collection, doc, addDoc, updateDoc, getDoc, getDocs,
    query, where, orderBy, limit, serverTimestamp, Timestamp, writeBatch,
} from 'firebase/firestore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(d);
}

const OPEN_STATUSES = ['PENDING', 'HELD'];

// ─── 1. Create / upsert a change request (with duplicate prevention) ──────────

/**
 * upsertChangeRequest(params)
 *
 * Creates a new changeRequests doc.
 * If an unresolved request already exists for the same
 * (vendorId + vendorItemId + requestType), it updates the existing one
 * instead of creating a duplicate.
 *
 * @returns {string} document ID of the created/updated request
 */
export async function upsertChangeRequest(params) {
    const {
        requestType = 'NEW_ITEM',  // NEW_ITEM | EDIT | DELETE | DEACTIVATE | MAPPING
        vendorId    = '',
        vendorName  = '',
        vendorItemId = '',
        catalogItemId = null,
        itemName    = '',
        category    = '',
        unit        = '',
        packSize    = '',
        price       = 0,
        taxRate     = null,
        notes       = '',
        source      = 'IMPORT',  // IMPORT | VENDOR_EDIT | ADMIN_CREATE | MAPPING_FIX
        proposedData = {},       // full proposed item fields
        createdBy   = '',
    } = params;

    // ── Duplicate check ──────────────────────────────────────────────────────
    if (vendorId && vendorItemId) {
        const dupSnap = await getDocs(query(
            collection(db, 'changeRequests'),
            where('vendorId',    '==', vendorId),
            where('vendorItemId','==', vendorItemId),
            where('requestType', '==', requestType),
            where('status',      'in', OPEN_STATUSES),
            limit(1),
        ));
        if (!dupSnap.empty) {
            // Update existing open request with fresh proposedData
            const existingRef = dupSnap.docs[0].ref;
            await updateDoc(existingRef, {
                proposedData,
                itemName: itemName || proposedData.itemName || '',
                price:    price    || proposedData.price    || 0,
                packSize: packSize || proposedData.packSize || '',
                unit:     unit     || proposedData.unit     || '',
                updatedAt: serverTimestamp(),
                notes:    notes || '',
            });
            return dupSnap.docs[0].id;
        }
    }

    // ── Create new request ───────────────────────────────────────────────────
    const ref = await addDoc(collection(db, 'changeRequests'), {
        requestType,
        status:      'PENDING',
        vendorId,
        vendorName,
        vendorItemId,
        catalogItemId: catalogItemId || null,
        itemName:  itemName  || proposedData.itemName  || '',
        category:  category  || proposedData.category  || '',
        unit:      unit      || proposedData.unit      || '',
        packSize:  packSize  || proposedData.packSize  || '',
        price:     price     || parseFloat(proposedData.price || 0),
        taxRate:   taxRate   ?? null,
        notes:     notes     || '',
        source,
        proposedData,
        createdAt:  serverTimestamp(),
        updatedAt:  serverTimestamp(),
        createdBy,
        resolvedAt: null,
        resolvedBy: null,
    });

    return ref.id;
}

// ─── 2. Fetch change requests ─────────────────────────────────────────────────

/**
 * getChangeRequests(filters)
 * Returns change requests from `changeRequests` collection.
 *
 * @param {object} filters  status, requestType, vendorId, pageSize
 */
export async function getChangeRequests(filters = {}) {
    const {
        status,       // "PENDING" | "HELD" | "APPROVED" | "REJECTED" | null (all open)
        requestType,  // "NEW_ITEM" | "EDIT" | "DELETE" | "DEACTIVATE" | "MAPPING" | null
        vendorId,
        pageSize = 100,
    } = filters;

    const constraints = [];

    if (status) {
        constraints.push(where('status', '==', status));
    } else {
        constraints.push(where('status', 'in', OPEN_STATUSES));
    }

    if (requestType) constraints.push(where('requestType', '==', requestType));
    if (vendorId)    constraints.push(where('vendorId',     '==', vendorId));

    constraints.push(orderBy('createdAt', 'desc'));
    constraints.push(limit(pageSize));

    const snap = await getDocs(query(collection(db, 'changeRequests'), ...constraints));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── 3. Summary counters (all from changeRequests) ───────────────────────────

/**
 * getChangeRequestSummary()
 * Returns KPI counts for the review queue dashboard.
 * All data comes from `changeRequests` only.
 */
export async function getChangeRequestSummary() {
    const today = todayStart();

    const [pendingSnap, heldSnap, approvedTodaySnap, rejectedTodaySnap] = await Promise.all([
        getDocs(query(collection(db, 'changeRequests'), where('status', '==', 'PENDING'))),
        getDocs(query(collection(db, 'changeRequests'), where('status', '==', 'HELD'))),
        getDocs(query(collection(db, 'changeRequests'), where('status', '==', 'APPROVED'), where('resolvedAt', '>=', today))),
        getDocs(query(collection(db, 'changeRequests'), where('status', '==', 'REJECTED'), where('resolvedAt', '>=', today))),
    ]);

    const pending = pendingSnap.docs.map(d => d.data());
    const held    = heldSnap.docs.map(d => d.data());
    const open    = [...pending, ...held];

    return {
        totalPending:     pending.length,
        totalHeld:        held.length,
        totalOpen:        open.length,
        approvedToday:    approvedTodaySnap.size,
        rejectedToday:    rejectedTodaySnap.size,
        newItems:         open.filter(d => d.requestType === 'NEW_ITEM').length,
        edits:            open.filter(d => d.requestType === 'EDIT').length,
        deletes:          open.filter(d => d.requestType === 'DELETE').length,
        deactivations:    open.filter(d => d.requestType === 'DEACTIVATE').length,
        mappings:         open.filter(d => d.requestType === 'MAPPING').length,
    };
}

// ─── 4. Approve ──────────────────────────────────────────────────────────────

/**
 * approveChangeRequest(requestId, options, reviewerInfo)
 *
 * 1. Updates vendors/{vendorId}/items/{vendorItemId}:
 *    reviewStatus = "approved", mapped/catalogItemId if applicable
 * 2. Updates changeRequests/{requestId}:
 *    status = "APPROVED", resolvedAt, resolvedBy
 *
 * Uses a batched write so both updates are atomic.
 */
export async function approveChangeRequest(requestId, options = {}, reviewerInfo = {}) {
    const { catalogItemId = null, mappedFields = {} } = options;
    const { userId = '', displayName = '' } = reviewerInfo;
    const resolvedBy = displayName || userId || 'superadmin';

    const reqSnap = await getDoc(doc(db, 'changeRequests', requestId));
    if (!reqSnap.exists()) throw new Error('Change request not found');
    const req = reqSnap.data();

    const batch = writeBatch(db);

    // ── Update vendor item ─────────────────────────────────────────────────
    if (req.vendorId && req.vendorItemId) {
        const itemRef = doc(db, 'vendors', req.vendorId, 'items', req.vendorItemId);
        const itemUpdate = {
            reviewStatus: 'approved',
            updatedAt:    serverTimestamp(),
            updatedBy:    resolvedBy,
        };
        // For NEW_ITEM or MAPPING — set catalogItemId and mapped flag
        if (['NEW_ITEM', 'MAPPING'].includes(req.requestType)) {
            const cid = catalogItemId || req.catalogItemId || null;
            if (cid) {
                itemUpdate.catalogItemId  = cid;
                itemUpdate.mapped         = true;
                itemUpdate.mappingStatus  = 'mapped';
            }
        }
        // Apply any additional proposed field updates
        if (req.requestType === 'EDIT' && req.proposedData) {
            const pd = req.proposedData;
            if (pd.price    !== undefined) itemUpdate.vendorPrice = parseFloat(pd.price || 0);
            if (pd.packSize !== undefined) itemUpdate.packSize    = pd.packSize;
            if (pd.unit     !== undefined) itemUpdate.unit        = pd.unit;
            if (pd.category !== undefined) itemUpdate.category    = pd.category;
        }
        Object.assign(itemUpdate, mappedFields);
        batch.update(itemRef, itemUpdate);
    }

    // ── Update change request ──────────────────────────────────────────────
    batch.update(doc(db, 'changeRequests', requestId), {
        status:     'APPROVED',
        resolvedAt: serverTimestamp(),
        resolvedBy,
        updatedAt:  serverTimestamp(),
        ...(catalogItemId ? { catalogItemId } : {}),
    });

    await batch.commit();
    return { success: true };
}

// ─── 5. Reject ───────────────────────────────────────────────────────────────

export async function rejectChangeRequest(requestId, reason = '', reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;
    const resolvedBy = displayName || userId || 'superadmin';

    const reqSnap = await getDoc(doc(db, 'changeRequests', requestId));
    if (!reqSnap.exists()) throw new Error('Change request not found');
    const req = reqSnap.data();

    const batch = writeBatch(db);

    if (req.vendorId && req.vendorItemId) {
        batch.update(doc(db, 'vendors', req.vendorId, 'items', req.vendorItemId), {
            reviewStatus: 'rejected',
            updatedAt:    serverTimestamp(),
            updatedBy:    resolvedBy,
        });
    }

    batch.update(doc(db, 'changeRequests', requestId), {
        status:     'REJECTED',
        resolvedAt: serverTimestamp(),
        resolvedBy,
        updatedAt:  serverTimestamp(),
        notes:      reason || 'Rejected by superadmin',
    });

    await batch.commit();
    return { success: true };
}

// ─── 6. Hold ─────────────────────────────────────────────────────────────────

export async function holdChangeRequest(requestId, notes = '', reviewerInfo = {}) {
    const { userId = '', displayName = '' } = reviewerInfo;

    await updateDoc(doc(db, 'changeRequests', requestId), {
        status:    'HELD',
        notes:     notes || 'Held for later review',
        updatedAt: serverTimestamp(),
        updatedBy: displayName || userId || 'superadmin',
    });
    return { success: true };
}

// ─── 7. Bulk actions ─────────────────────────────────────────────────────────

export async function bulkApproveChangeRequests(ids, options, reviewerInfo) {
    return Promise.all(ids.map(id => approveChangeRequest(id, options, reviewerInfo)));
}
export async function bulkRejectChangeRequests(ids, reason, reviewerInfo) {
    return Promise.all(ids.map(id => rejectChangeRequest(id, reason, reviewerInfo)));
}
export async function bulkHoldChangeRequests(ids, notes, reviewerInfo) {
    return Promise.all(ids.map(id => holdChangeRequest(id, notes, reviewerInfo)));
}

// ─── 8. Get open request for a specific vendor item (for dedup badge check) ──

export async function getOpenRequestForItem(vendorItemId) {
    if (!vendorItemId) return null;
    const snap = await getDocs(query(
        collection(db, 'changeRequests'),
        where('vendorItemId', '==', vendorItemId),
        where('status', 'in', OPEN_STATUSES),
        limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
