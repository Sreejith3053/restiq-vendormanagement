/**
 * adminAuditLogger.js
 *
 * Shared audit logging utility for admin changes.
 * Writes to `adminChangeLogs/{logId}` in Firestore.
 *
 * Supported entity types:
 *   restaurant, catalogItem, vendorItem, mappingReview,
 *   order, invoice, dispatch, issue, allocation, payment, vendor
 *
 * Supported actions:
 *   created, updated, status_changed, mapped, ignored, bulk_update, deleted,
 *   status_transition, invoice_created, payment_updated, dispatch_sent,
 *   issue_opened, issue_resolved, allocation_changed, merged
 */
import { db } from '../firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * Log an admin change to the adminChangeLogs collection.
 *
 * @param {Object} opts
 * @param {string} opts.entityType     - Entity type (see supported list above)
 * @param {string} opts.entityId       - Document ID that was changed
 * @param {string} opts.action         - Action type (see supported list above)
 * @param {string} [opts.changedBy]    - User display name or ID
 * @param {Object} [opts.changedFields]  - { field: { from, to } }
 * @param {Object} [opts.beforeState]  - Snapshot of entity before the change
 * @param {Object} [opts.afterState]   - Snapshot of entity after the change
 * @param {Object} [opts.metadata]     - Any extra data
 * @returns {Promise<string>} - docId of the log entry
 */
export async function logAdminChange({ entityType, entityId, action, changedBy, changedFields, beforeState, afterState, metadata }) {
    try {
        const entry = {
            entityType,
            entityId,
            action,
            changedBy: changedBy || 'SuperAdmin',
            changedFields: changedFields || {},
            metadata: metadata || {},
            timestamp: serverTimestamp(),
        };
        // Only include state snapshots if provided (keeps doc size small)
        if (beforeState) entry.beforeState = beforeState;
        if (afterState) entry.afterState = afterState;

        const docRef = await addDoc(collection(db, 'adminChangeLogs'), entry);
        return docRef.id;
    } catch (err) {
        console.warn('[AuditLog] Failed to write:', err);
        return null;
    }
}

// ── Convenience wrappers ────────────────────────────────────────────────────

/**
 * Log an order status transition.
 */
export function logOrderTransition({ orderId, fromStatus, toStatus, changedBy, metadata }) {
    return logAdminChange({
        entityType: 'order',
        entityId: orderId,
        action: 'status_transition',
        changedBy,
        changedFields: { status: { from: fromStatus, to: toStatus } },
        beforeState: { status: fromStatus },
        afterState: { status: toStatus },
        metadata,
    });
}

/**
 * Log an invoice creation.
 */
export function logInvoiceCreated({ invoiceId, restaurantId, amount, changedBy, metadata }) {
    return logAdminChange({
        entityType: 'invoice',
        entityId: invoiceId,
        action: 'invoice_created',
        changedBy,
        afterState: { restaurantId, amount },
        metadata,
    });
}

/**
 * Log a dispatch send.
 */
export function logDispatchSent({ dispatchId, vendorId, vendorName, weekStart, changedBy, metadata }) {
    return logAdminChange({
        entityType: 'dispatch',
        entityId: dispatchId,
        action: 'dispatch_sent',
        changedBy,
        afterState: { vendorId, vendorName, weekStart, status: 'Sent' },
        metadata,
    });
}

/**
 * Log a payment status update.
 */
export function logPaymentUpdate({ invoiceId, fromStatus, toStatus, changedBy, metadata }) {
    return logAdminChange({
        entityType: 'payment',
        entityId: invoiceId,
        action: 'payment_updated',
        changedBy,
        changedFields: { paymentStatus: { from: fromStatus, to: toStatus } },
        beforeState: { paymentStatus: fromStatus },
        afterState: { paymentStatus: toStatus },
        metadata,
    });
}

/**
 * Log an issue lifecycle event.
 */
export function logIssueEvent({ issueId, action, changedBy, beforeState, afterState, metadata }) {
    return logAdminChange({
        entityType: 'issue',
        entityId: issueId,
        action: action || 'issue_opened',
        changedBy,
        beforeState,
        afterState,
        metadata,
    });
}
