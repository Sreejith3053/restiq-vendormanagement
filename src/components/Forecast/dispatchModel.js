/**
 * dispatchModel.js
 *
 * Shared dispatch model utilities for RestIQ Solutions.
 *
 * Data model:
 *   vendorDispatches       — weekly parent (one per vendor per week)
 *   vendorDispatchRoutes   — route-day children (one per routeDay per dispatchId)
 *
 * Usage:
 *   Financial summaries, vendor cards → use vendorDispatches
 *   Pipeline counts, Confirmations, Warehouse, Delivery → use vendorDispatchRoutes
 */

import { db } from '../../firebase';
import {
    collection,
    doc,
    setDoc,
    addDoc,
    getDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { logDispatchSent } from '../../utils/adminAuditLogger';
import { ops } from '../../services/operationsLogger';

// ── Week helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the ISO string for the Monday that starts the current active week.
 * Always anchors to Monday 00:00:00 UTC.
 */
export function getActiveWeekStart(referenceDate = new Date()) {
    const d = new Date(referenceDate);
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day; // go back to Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Returns the ISO string for 7 days after weekStart.
 */
export function getWeekEnd(weekStart) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
}

/**
 * Human-readable week label: "Mar 11 – Mar 17, 2026"
 */
export function formatWeekLabel(weekStartStr) {
    const d = new Date(weekStartStr);
    const end = new Date(d);
    end.setDate(d.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    return `${d.toLocaleDateString('en-CA', opts)} – ${end.toLocaleDateString('en-CA', opts)}, ${end.getFullYear()}`;
}

/**
 * Returns true if a Firestore Timestamp or ISO string falls within the given ISO week start.
 */
export function isInWeek(ts, weekStartStr) {
    if (!ts || !weekStartStr) return false;
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return false;
    const weekStart = new Date(weekStartStr);
    const weekEnd = new Date(weekStartStr);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return d >= weekStart && d < weekEnd;
}

/**
 * Derive parent overallStatus from child route statuses.
 * Rules per spec:
 *   all Draft               → Draft
 *   any Sent, some Draft    → In Progress
 *   all Sent                → Sent
 *   any Partially Confirmed → Partial
 *   all Confirmed | Partially | Delivered | Closed → Confirmed
 *   all Delivered           → Delivered
 *   all Closed              → Closed
 */
export function deriveOverallStatus(routeStatuses = []) {
    if (!routeStatuses.length) return 'Draft';
    const s = routeStatuses;

    if (s.every(x => x === 'Draft')) return 'Draft';
    if (s.every(x => x === 'Closed')) return 'Closed';
    if (s.every(x => x === 'Delivered' || x === 'Closed')) return 'Delivered';
    if (s.some(x => x === 'Partially Confirmed') || (s.some(x => x === 'Confirmed') && !s.every(x => x === 'Confirmed' || x === 'Delivered' || x === 'Closed'))) return 'Partial';
    if (s.every(x => x === 'Confirmed' || x === 'Delivered' || x === 'Closed')) return 'Confirmed';
    if (s.every(x => x === 'Sent')) return 'Sent';
    if (s.some(x => x === 'Sent') || s.some(x => x === 'Confirmed')) return 'In Progress';
    return 'Draft';
}

// ── Dispatch write helpers ───────────────────────────────────────────────────

/**
 * Write or update the parent weekly dispatch record.
 * vendorDispatches/{dispatchId}
 */
export async function upsertParentDispatch(payload) {
    const ref = doc(db, 'vendorDispatches', payload.dispatchId);
    await setDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

/**
 * Write a child route-day dispatch record.
 * vendorDispatchRoutes/{routeDispatchId}
 */
export async function writeRouteDispatch(payload) {
    const ref = doc(db, 'vendorDispatchRoutes', payload.routeDispatchId);
    await setDoc(ref, {
        ...payload,
        createdAt: payload.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

/**
 * Full send: writes parent + both route-day children in one call.
 *
 * @param {Object} vendor - vendor object from Control Tower state
 * @param {string} weekStart - ISO date string for Monday of delivery week
 * @param {string} weekEnd   - ISO date string for Sunday
 * @param {string} weekLabel - Human readable label
 * @returns {Promise<{dispatchId, monRouteId, thuRouteId}>}
 */
export async function sendVendorDispatch(vendor, weekStart, weekEnd, weekLabel) {
    const dispatchId = `disp_${vendor.vendorId}_${weekStart.replace(/-/g, '')}`;
    const monRouteId = `${dispatchId}_Mon`;
    const thuRouteId = `${dispatchId}_Thu`;

    const itemsPayload = (vendor.items || []).map(i => ({
        itemId: i.itemName.toLowerCase().replace(/\s+/g, '-'),
        itemName: i.itemName,
        packLabel: i.displayVendorPackStr || i.packLabel || '—',
        mondayQty: i.mondayQty || 0,
        thursdayQty: i.thursdayQty || 0,
        catalogSellPrice: i.catalogSellPrice || 0,
        lineMarketplaceCommission: i.lineMarketplaceCommission || 0,
        lineVendorPayout: i.lineVendorPayout || 0,
        lineRestaurantBilling: i.lineRestaurantBilling || 0,
        category: i.category || '',
        // Snapshot fields for historical accuracy
        vendorItemId: i.vendorItemId || i.itemId || null,
        catalogItemId: i.catalogItemId || null,
        itemNameSnapshot: i.itemName || 'Unknown Item',
        priceSnapshot: Number(i.vendorPrice ?? i.price ?? i.catalogSellPrice ?? 0),
        unitSnapshot: i.unit || i.packLabel || 'unit',
        vendorNameSnapshot: vendor.name || null,
        packSizeSnapshot: i.packQuantity || i.packSize || null,
        categorySnapshot: i.category || null,
        taxableSnapshot: !!i.taxable,
    }));

    const monItems = itemsPayload.filter(i => i.mondayQty > 0).map(i => ({ ...i, qty: i.mondayQty }));
    const thuItems = itemsPayload.filter(i => i.thursdayQty > 0).map(i => ({ ...i, qty: i.thursdayQty }));

    // Parent record
    await upsertParentDispatch({
        dispatchId,
        vendorId: vendor.vendorId,
        vendorName: vendor.name,
        weekStart,
        weekEnd,
        weekLabel,
        routeDays: ['Monday', 'Thursday'],
        mondayTotalPacks: vendor.mon || 0,
        thursdayTotalPacks: vendor.thu || 0,
        restaurantBillingTotal: vendor.bill || 0,
        vendorPayoutTotal: vendor.pay || 0,
        marketplaceCommissionTotal: vendor.comm || 0,
        overallStatus: 'Sent',
        mondaySent: true,
        thursdaySent: true,
        sentAt: serverTimestamp(),
        confirmedAt: null,
        deliveredAt: null,
        items: itemsPayload,
        createdAt: serverTimestamp(),
    });

    // Monday route child
    await writeRouteDispatch({
        routeDispatchId: monRouteId,
        dispatchId,
        vendorId: vendor.vendorId,
        vendorName: vendor.name,
        weekStart,
        weekEnd,
        weekLabel,
        routeDay: 'Monday',
        totalPacks: vendor.mon || 0,
        status: 'Sent',
        sentAt: serverTimestamp(),
        confirmedAt: null,
        deliveredAt: null,
        warehouseStatus: null,
        items: monItems,
        notes: '',
    });

    // Thursday route child
    await writeRouteDispatch({
        routeDispatchId: thuRouteId,
        dispatchId,
        vendorId: vendor.vendorId,
        vendorName: vendor.name,
        weekStart,
        weekEnd,
        weekLabel,
        routeDay: 'Thursday',
        totalPacks: vendor.thu || 0,
        status: 'Sent',
        sentAt: serverTimestamp(),
        confirmedAt: null,
        deliveredAt: null,
        warehouseStatus: null,
        items: thuItems,
        notes: '',
    });

    // Audit log
    logDispatchSent({ dispatchId, vendorId: vendor.vendorId, vendorName: vendor.name, weekStart });
    ops.info('dispatch_sent', { dispatchId, vendorId: vendor.vendorId, vendorName: vendor.name, weekStart });

    return { dispatchId, monRouteId, thuRouteId };
}
