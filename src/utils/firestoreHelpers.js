/**
 * firestoreHelpers.js
 *
 * Shared utilities for Firestore data model consistency.
 * Handles backward-compatible timestamp display, transactional snapshot field building,
 * and cursor-based pagination helpers.
 */
import { serverTimestamp, limit, startAfter, query } from 'firebase/firestore';


// ── Timestamp Helpers ───────────────────────────────────────────────────────

/**
 * Safely convert a Firestore Timestamp, ISO string, or Date to a JS Date.
 * Returns null if the value is falsy or unparseable.
 *
 * @param {import('firebase/firestore').Timestamp | string | Date | null | undefined} ts
 * @returns {Date | null}
 */
export function toSafeDate(ts) {
    if (!ts) return null;
    // Firestore Timestamp object
    if (ts.toDate && typeof ts.toDate === 'function') {
        try { return ts.toDate(); } catch { return null; }
    }
    // Already a Date
    if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
    // ISO string or other string
    if (typeof ts === 'string') {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? null : d;
    }
    // Numeric timestamp (ms)
    if (typeof ts === 'number') {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/**
 * Format a timestamp for display. Handles Firestore Timestamps and legacy ISO strings.
 *
 * @param {import('firebase/firestore').Timestamp | string | Date | null} ts
 * @param {Intl.DateTimeFormatOptions} [opts] - Intl options for formatting
 * @returns {string} Formatted date string or '—' if invalid
 */
export function formatTimestamp(ts, opts) {
    const d = toSafeDate(ts);
    if (!d) return '—';
    const defaultOpts = { dateStyle: 'medium', timeStyle: 'short' };
    return d.toLocaleString('en-CA', opts || defaultOpts);
}

/**
 * Format a timestamp as a short date only (no time).
 *
 * @param {import('firebase/firestore').Timestamp | string | Date | null} ts
 * @returns {string}
 */
export function formatDateOnly(ts) {
    const d = toSafeDate(ts);
    if (!d) return '—';
    return d.toLocaleDateString('en-CA', { dateStyle: 'medium' });
}

// ── Line Item Display Helpers (backward-compatible fallbacks) ───────────────

/**
 * Get the display name for a transactional line item.
 * Prefers snapshot fields, falls back to legacy field names.
 *
 * @param {Object} item - A line item from an order, dispatch, or invoice
 * @returns {string}
 */
export function getItemDisplayName(item) {
    if (!item) return 'Unknown Item';
    return item.itemNameSnapshot || item.itemName || item.name || 'Unknown Item';
}

/**
 * Get the price for a transactional line item.
 * Prefers snapshot fields, falls back to legacy field names.
 *
 * @param {Object} item
 * @returns {number}
 */
export function getItemPrice(item) {
    if (!item) return 0;
    return Number(item.vendorPriceSnapshot ?? item.priceSnapshot ?? item.vendorPrice ?? item.price ?? 0);
}

/**
 * Get the unit for a transactional line item.
 *
 * @param {Object} item
 * @returns {string}
 */
export function getItemUnit(item) {
    if (!item) return 'unit';
    return item.unitSnapshot || item.unit || 'unit';
}

// ── v2 Read Helpers ─────────────────────────────────────────────────────────

/**
 * Get the base unit for a vendor item (v2 canonical field with legacy fallback).
 * @param {Object} item
 * @returns {string}
 */
export function getItemBaseUnit(item) {
    if (!item) return 'unit';
    return item.baseUnit || item.unit || 'unit';
}

/**
 * Get the order unit for a vendor item (v2 canonical field with legacy fallback).
 * @param {Object} item
 * @returns {string}
 */
export function getItemOrderUnit(item) {
    if (!item) return 'unit';
    return item.orderUnit || item.baseUnit || item.unit || 'unit';
}

/**
 * Get the canonical display name for a catalog item or vendor item.
 * Prefers v2 canonicalName, falls back to itemName / name.
 * @param {Object} item
 * @returns {string}
 */
export function getCatalogDisplayName(item) {
    if (!item) return '';
    return item.canonicalName || item.itemName || item.name || '';
}

/**
 * Get a normalized (lowercase) status for filtering/logic.
 * Uses the v2 normalizedStatus field if present, otherwise derives from status.
 * @param {Object} item
 * @returns {string}
 */
export function getItemNormalizedStatus(item) {
    if (!item) return '';
    return item.normalizedStatus || (item.status || '').toLowerCase();
}

// ── Snapshot Builder ────────────────────────────────────────────────────────

/**
 * Build standardized snapshot fields for a transactional line item.
 * Call this when writing orders, dispatches, or invoices to freeze
 * the item's identity and pricing at the time of the transaction.
 *
 * @param {Object} vendorItem - The vendor item document data
 * @param {string} vendorItemId - The Firestore doc ID of the vendor item
 * @param {Object} [vendorInfo] - Optional vendor profile data
 * @returns {Object} Snapshot fields to spread into the line item
 */
export function buildLineItemSnapshot(vendorItem, vendorItemId, vendorInfo = {}) {
    const price = Number(vendorItem?.vendorPrice ?? vendorItem?.price ?? 0);
    return {
        // Relational identity
        vendorItemId: vendorItemId || vendorItem?.id || null,
        catalogItemId: vendorItem?.catalogItemId || null,

        // Historical display snapshots (both v1 and v2 alias written)
        itemNameSnapshot: vendorItem?.itemName || vendorItem?.name || 'Unknown Item',
        priceSnapshot:       price,   // legacy alias kept
        vendorPriceSnapshot: price,   // v2 canonical alias
        unitSnapshot: vendorItem?.baseUnit || vendorItem?.unit || 'unit',

        // Recommended additional snapshots
        vendorNameSnapshot: vendorInfo?.name || vendorInfo?.vendorName || null,
        packSizeSnapshot: vendorItem?.packQuantity || vendorItem?.packSize || null,
        packLabelSnapshot: vendorItem?.packLabel || vendorItem?.itemSize || null,
        categorySnapshot: vendorItem?.category || null,
        baseUnitSnapshot: vendorItem?.baseUnit || vendorItem?.unit || null,
        taxableSnapshot: !!vendorItem?.taxable,
        itemCodeSnapshot: vendorItem?.sku || null,
    };
}

/**
 * Merge snapshot fields into an existing line item object,
 * preserving any existing legacy fields for backward compatibility.
 *
 * @param {Object} lineItem - The existing line item
 * @param {Object} snapshotFields - Output of buildLineItemSnapshot
 * @returns {Object} Merged line item
 */
export function mergeSnapshotIntoLineItem(lineItem, snapshotFields) {
    return {
        ...lineItem,
        ...snapshotFields,
        // Preserve legacy fields for backward compatibility
        itemName: snapshotFields.itemNameSnapshot || lineItem.itemName || lineItem.name,
        name: snapshotFields.itemNameSnapshot || lineItem.name || lineItem.itemName,
        vendorPrice: snapshotFields.priceSnapshot ?? lineItem.vendorPrice ?? lineItem.price ?? 0,
        unit: snapshotFields.unitSnapshot || lineItem.unit || 'unit',
    };
}

// ── Pagination Helpers ───────────────────────────────────────────────────────

/**
 * Build a paginated Firestore query using cursor-based pagination (startAfter).
 *
 * Usage:
 *   const firstPage = await getDocs(paginatedQuery(baseQuery, [], 50));
 *   const lastDoc = firstPage.docs[firstPage.docs.length - 1];
 *   const nextPage = await getDocs(paginatedQuery(baseQuery, [], 50, lastDoc));
 *
 * @param {import('firebase/firestore').Query} baseQuery - Already-constrained query (with where/orderBy)
 * @param {import('firebase/firestore').QueryConstraint[]} extraConstraints - Additional constraints
 * @param {number} [pageSize=50] - Number of documents per page
 * @param {import('firebase/firestore').DocumentSnapshot|null} [lastVisible=null] - Last doc from previous page
 * @returns {import('firebase/firestore').Query}
 */
export function paginatedQuery(baseQuery, extraConstraints = [], pageSize = 50, lastVisible = null) {
    const constraints = [...extraConstraints, limit(pageSize)];
    if (lastVisible) constraints.push(startAfter(lastVisible));
    return query(baseQuery, ...constraints);
}

