/**
 * vendorAuditService.js
 * 
 * Tracks vendor-side audit logs for:
 * - price changes
 * - item edits
 * - dispatch confirmations
 * - profile edits
 * - capacity edits
 * - user management actions
 * 
 * Writes to vendors/{vendorId}/auditLog subcollection.
 */
import { db } from '../../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Log a vendor audit event.
 * @param {Object} params
 * @param {string} params.vendorId - Vendor ID
 * @param {string} params.entityType - 'item' | 'dispatch' | 'profile' | 'capacity' | 'user' | 'invoice' | 'availability'
 * @param {string} params.entityId - ID of the entity being modified
 * @param {string} params.actionType - 'create' | 'update' | 'delete' | 'confirm' | 'reject' | 'import'
 * @param {Object} params.beforeState - Previous state (relevant fields only)
 * @param {Object} params.afterState - New state
 * @param {string} params.performedBy - User display name or ID
 * @param {string} params.notes - Optional description
 */
export async function logVendorAudit({
    vendorId,
    entityType,
    entityId,
    actionType,
    beforeState = null,
    afterState = null,
    performedBy = 'Vendor',
    notes = '',
}) {
    if (!vendorId) return;
    try {
        await addDoc(collection(db, `vendors/${vendorId}/auditLog`), {
            entityType,
            entityId: entityId || '',
            actionType,
            beforeState: beforeState ? JSON.parse(JSON.stringify(beforeState)) : null,
            afterState: afterState ? JSON.parse(JSON.stringify(afterState)) : null,
            performedBy,
            notes,
            timestamp: serverTimestamp(),
        });
    } catch (err) {
        console.warn('[VendorAudit] Failed to log:', err.message);
        // Non-blocking — audit failures should not disrupt vendor operations
    }
}

/**
 * Log a price change specifically.
 */
export async function logPriceChange(vendorId, itemId, oldPrice, newPrice, performedBy) {
    return logVendorAudit({
        vendorId,
        entityType: 'item',
        entityId: itemId,
        actionType: 'update',
        beforeState: { price: oldPrice },
        afterState: { price: newPrice },
        performedBy,
        notes: `Price changed from $${oldPrice} to $${newPrice}`,
    });
}

/**
 * Log a dispatch action.
 */
export async function logDispatchAction(vendorId, dispatchId, action, details, performedBy) {
    return logVendorAudit({
        vendorId,
        entityType: 'dispatch',
        entityId: dispatchId,
        actionType: action,
        afterState: details,
        performedBy,
        notes: `Dispatch ${action}`,
    });
}

/**
 * Log a capacity update.
 */
export async function logCapacityUpdate(vendorId, weekStart, capacityData, performedBy) {
    return logVendorAudit({
        vendorId,
        entityType: 'capacity',
        entityId: weekStart,
        actionType: 'update',
        afterState: capacityData,
        performedBy,
        notes: `Capacity updated for week ${weekStart}`,
    });
}
