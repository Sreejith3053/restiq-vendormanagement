/**
 * adminAuditLogger.js
 *
 * Shared audit logging utility for admin changes.
 * Writes to `adminChangeLogs/{logId}` in Firestore.
 */
import { db } from '../firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * Log an admin change to the adminChangeLogs collection.
 *
 * @param {Object} opts
 * @param {string} opts.entityType     - 'restaurant' | 'catalogItem' | 'vendorItem' | 'mappingReview'
 * @param {string} opts.entityId       - Document ID that was changed
 * @param {string} opts.action         - 'created' | 'updated' | 'status_changed' | 'mapped' | 'ignored' | 'bulk_update' | 'deleted'
 * @param {string} [opts.changedBy]    - User display name or ID
 * @param {Object} [opts.changedFields]  - { field: { from, to } }
 * @param {Object} [opts.metadata]     - Any extra data
 * @returns {Promise<string>} - docId of the log entry
 */
export async function logAdminChange({ entityType, entityId, action, changedBy, changedFields, metadata }) {
    try {
        const docRef = await addDoc(collection(db, 'adminChangeLogs'), {
            entityType,
            entityId,
            action,
            changedBy: changedBy || 'SuperAdmin',
            changedFields: changedFields || {},
            metadata: metadata || {},
            timestamp: serverTimestamp(),
        });
        return docRef.id;
    } catch (err) {
        console.warn('[AuditLog] Failed to write:', err);
        return null;
    }
}
