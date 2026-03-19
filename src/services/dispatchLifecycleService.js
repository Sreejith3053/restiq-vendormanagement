/**
 * dispatchLifecycleService.js
 * 
 * Manages the full dispatch lifecycle including:
 * - Extended delivery statuses (Packed, Out for Delivery, Delivered, Delayed, Failed)
 * - Cancellation handling (vendor, admin, partial)
 * - Substitution validation
 * - Time tracking for all state transitions
 */
import { db } from '../firebase';
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

/* ── Status Flow ── */
const STATUS_FLOW = {
    'Sent':                 ['Confirmed', 'Partially Confirmed', 'Rejected', 'Cancelled'],
    'Confirmed':            ['Packed', 'Cancelled'],
    'Partially Confirmed':  ['Packed', 'Cancelled'],
    'Packed':               ['Out for Delivery', 'Cancelled'],
    'Out for Delivery':     ['Delivered', 'Delivery Delayed', 'Delivery Failed'],
    'Delivery Delayed':     ['Out for Delivery', 'Delivered', 'Delivery Failed'],
    'Delivery Failed':      ['Out for Delivery', 'Cancelled'],
    'Delivered':            [], // terminal
    'Rejected':             [], // terminal
    'Cancelled':            [], // terminal
};

/**
 * Transition a dispatch to a new status with full validation and time tracking.
 *
 * @param {string} dispatchId
 * @param {string} newStatus
 * @param {Object} [options]
 * @param {string} [options.performedBy='system']
 * @param {string} [options.reason]
 * @param {string} [options.cancellationType] - 'vendor' | 'admin' | 'partial'
 * @param {Array}  [options.cancelledItems] - items cancelled in partial cancellation
 * @param {string} [options.estimatedDeliveryTime]
 * @param {string} [options.delayReason]
 * @param {string} [options.failureReason]
 * @returns {Promise<Object>} - { previousStatus, newStatus, timestamps }
 */
export async function transitionDispatchStatus(dispatchId, newStatus, options = {}) {
    const ref = doc(db, 'vendorDispatches', dispatchId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Dispatch not found');

    const data = snap.data();
    const currentStatus = data.status || 'Sent';
    const allowed = STATUS_FLOW[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
        throw new Error(`Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed: ${allowed.join(', ')}`);
    }

    // Build timestamp key for this transition
    const tsKey = `ts_${newStatus.replace(/\s+/g, '_').toLowerCase()}`;
    const now = new Date().toISOString();

    const update = {
        status: newStatus,
        [tsKey]: now,
        updatedAt: serverTimestamp(),
    };

    // Preserve all existing timestamps
    const timestamps = { ...(data.timestamps || {}) };
    timestamps[newStatus] = now;
    update.timestamps = timestamps;

    // Handle cancellation
    if (newStatus === 'Cancelled') {
        update.cancellationType = options.cancellationType || 'vendor';
        update.cancellationReason = options.reason || '';
        update.cancelledBy = options.performedBy || 'system';
        update.cancelledAt = now;

        if (options.cancellationType === 'partial' && options.cancelledItems) {
            update.cancelledItems = options.cancelledItems;
        }
    }

    // Handle delivery delay
    if (newStatus === 'Delivery Delayed') {
        update.delayReason = options.delayReason || options.reason || '';
        update.delayedAt = now;
    }

    // Handle delivery failure
    if (newStatus === 'Delivery Failed') {
        update.failureReason = options.failureReason || options.reason || '';
        update.failedAt = now;
    }

    // Handle delivery
    if (newStatus === 'Delivered') {
        update.deliveredAt = now;
    }

    // Handle packed
    if (newStatus === 'Packed') {
        update.packedAt = now;
    }

    // Handle out for delivery
    if (newStatus === 'Out for Delivery') {
        update.outForDeliveryAt = now;
        if (options.estimatedDeliveryTime) {
            update.estimatedDeliveryTime = options.estimatedDeliveryTime;
        }
    }

    await updateDoc(ref, update);

    // Audit log
    try {
        await addDoc(collection(db, 'adminChangeLogs'), {
            entityType: 'dispatch',
            entityId: dispatchId,
            action: 'status_transition',
            changedBy: options.performedBy || 'system',
            changedFields: { status: { from: currentStatus, to: newStatus } },
            metadata: { reason: options.reason, cancellationType: options.cancellationType },
            timestamp: serverTimestamp(),
        });
    } catch (_) {}

    return { previousStatus: currentStatus, newStatus, timestamps };
}

/**
 * Validate and register a substitution for dispatch items.
 *
 * @param {string} dispatchId
 * @param {Object} substitution
 * @param {string} substitution.originalItemName
 * @param {string} substitution.substituteItemName
 * @param {number} substitution.substituteQty
 * @param {string} [substitution.substituteUnit]
 * @param {string} [substitution.note]
 * @param {string} [performedBy='vendor']
 */
export async function registerSubstitution(dispatchId, substitution, performedBy = 'vendor') {
    const ref = doc(db, 'vendorDispatches', dispatchId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Dispatch not found');

    const data = snap.data();

    if (!substitution.originalItemName) throw new Error('Original item name is required');
    if (!substitution.substituteItemName) throw new Error('Substitute item name is required');

    const subs = [...(data.substitutions || [])];
    subs.push({
        originalItemName: substitution.originalItemName,
        substituteItemName: substitution.substituteItemName,
        substituteQty: Number(substitution.substituteQty) || 0,
        substituteUnit: substitution.substituteUnit || '',
        note: substitution.note || '',
        registeredBy: performedBy,
        registeredAt: new Date().toISOString(),
    });

    await updateDoc(ref, { substitutions: subs, updatedAt: serverTimestamp() });

    return { substitutionCount: subs.length };
}

/**
 * Get full dispatch timeline with all timestamps.
 */
export async function getDispatchTimeline(dispatchId) {
    const ref = doc(db, 'vendorDispatches', dispatchId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;

    const data = snap.data();
    const timeline = [];

    const tsMap = data.timestamps || {};
    // Also check legacy timestamp fields
    const legacyFields = ['sentAt', 'confirmedAt', 'packedAt', 'outForDeliveryAt', 'deliveredAt', 'cancelledAt', 'delayedAt', 'failedAt'];
    legacyFields.forEach(f => {
        if (data[f] && !tsMap[f.replace('At', '')]) {
            const label = f.replace('At', '').replace(/([A-Z])/g, ' $1').trim();
            tsMap[label] = data[f];
        }
    });

    Object.entries(tsMap).forEach(([status, ts]) => {
        timeline.push({ status, timestamp: ts });
    });

    // Sort by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
        dispatchId,
        currentStatus: data.status || 'Sent',
        timeline,
        substitutions: data.substitutions || [],
        cancellation: data.cancellationType ? {
            type: data.cancellationType,
            reason: data.cancellationReason,
            by: data.cancelledBy,
            at: data.cancelledAt,
            cancelledItems: data.cancelledItems || [],
        } : null,
    };
}
