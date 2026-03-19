/**
 * idempotencyGuard.js
 *
 * Prevents duplicate execution of critical actions (invoice generation,
 * dispatch creation, issue creation) using deterministic idempotency keys.
 *
 * Usage:
 *   import { withIdempotency } from '../services/idempotencyGuard';
 *   const result = await withIdempotency('restaurantInvoices', `inv_${restId}_${weekStart}`, async () => {
 *       // create invoice
 *       return invoiceData;
 *   });
 *   if (result.alreadyExists) toast.info('Invoice already exists');
 */
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Check if a document with the given idempotency key already exists.
 *
 * @param {string} collectionName - Firestore collection
 * @param {string} idempotencyKey - Deterministic document ID
 * @returns {Promise<{ exists: boolean, data?: Object, docRef: import('firebase/firestore').DocumentReference }>}
 */
export async function checkIdempotency(collectionName, idempotencyKey) {
    const docRef = doc(db, collectionName, idempotencyKey);
    try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            return { exists: true, data: snap.data(), docRef };
        }
        return { exists: false, docRef };
    } catch (err) {
        console.error(`[IdempotencyGuard] Check failed for ${collectionName}/${idempotencyKey}:`, err);
        // On error, allow the operation but warn
        return { exists: false, docRef, error: err.message };
    }
}

/**
 * Execute a create action with idempotency protection.
 * If a document with the given key already exists, returns it instead of creating a duplicate.
 *
 * @param {string} collectionName - Firestore collection
 * @param {string} idempotencyKey - Deterministic document ID
 * @param {Function} createFn - Async function that returns the document data to write.
 *                               Receives the docRef as argument.
 * @param {Object} [options]
 * @param {boolean} [options.allowOverwrite=false] - If true, overwrites existing doc
 * @param {boolean} [options.merge=false] - If true, merges with existing doc
 * @returns {Promise<{ alreadyExists: boolean, data: Object, docId: string }>}
 */
export async function withIdempotency(collectionName, idempotencyKey, createFn, options = {}) {
    const { allowOverwrite = false, merge = false } = options;

    // Step 1: Check if already exists
    const check = await checkIdempotency(collectionName, idempotencyKey);

    if (check.exists && !allowOverwrite) {
        console.info(`[IdempotencyGuard] ${collectionName}/${idempotencyKey} already exists — skipping creation.`);
        return {
            alreadyExists: true,
            data: check.data,
            docId: idempotencyKey,
        };
    }

    // Step 2: Execute create function
    try {
        const data = await createFn(check.docRef);

        if (!data || typeof data !== 'object') {
            throw new Error('createFn must return a non-null object');
        }

        // Step 3: Write with deterministic ID
        const writeData = {
            ...data,
            _idempotencyKey: idempotencyKey,
            _createdAt: data._createdAt || serverTimestamp(),
            _updatedAt: serverTimestamp(),
        };

        await setDoc(check.docRef, writeData, { merge });

        return {
            alreadyExists: false,
            data: writeData,
            docId: idempotencyKey,
        };
    } catch (err) {
        console.error(`[IdempotencyGuard] Create failed for ${collectionName}/${idempotencyKey}:`, err);
        throw err; // Re-throw so callers can handle
    }
}

/**
 * Generate a deterministic idempotency key for common operations.
 *
 * @param {string} type - 'invoice' | 'dispatch' | 'issue'
 * @param {Object} params - Key params for the operation
 * @returns {string}
 */
export function generateIdempotencyKey(type, params = {}) {
    switch (type) {
        case 'invoice':
            // inv_{restaurantId}_{weekStart}_{orderId}
            return `inv_${params.restaurantId || 'unknown'}_${(params.weekStart || '').replace(/-/g, '')}_${params.orderId || 'batch'}`;
        case 'dispatch':
            // Already handled by dispatchModel.js: disp_{vendorId}_{weekStart}
            return `disp_${params.vendorId || 'unknown'}_${(params.weekStart || '').replace(/-/g, '')}`;
        case 'issue':
            // issue_{entityType}_{entityId}_{issueType}
            return `issue_${params.entityType || 'order'}_${params.entityId || 'unknown'}_${params.issueType || 'general'}`;
        default:
            return `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
}

/**
 * Safe retry wrapper — executes an async function with retry on failure.
 * Does NOT retry if the action was already completed (idempotent check first).
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.baseDelay=1000] - Base delay in ms (doubles each retry)
 * @returns {Promise<any>}
 */
export async function safeRetry(fn, options = {}) {
    const { maxRetries = 3, baseDelay = 1000 } = options;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastError = err;
            console.warn(`[SafeRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, err.message);

            if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    throw lastError;
}
