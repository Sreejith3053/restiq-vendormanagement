/**
 * retryService.js
 * 
 * Safe retry system with exponential backoff for failed operations.
 * 
 * Supports:
 * - Configurable max retries and backoff
 * - Operation-specific retry logic
 * - Partial failure handling (e.g., "invoice created but notification failed")
 * - Failure logging
 */

/**
 * Execute a function with retry logic.
 * 
 * @param {Function} fn - async function to execute
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.baseDelayMs=500]
 * @param {number} [options.maxDelayMs=10000]
 * @param {string} [options.operationName='operation']
 * @param {Function} [options.onRetry] - callback(attempt, error)
 * @param {Function} [options.shouldRetry] - (error) => boolean, default always true
 * @returns {Promise<Object>} - { success, result, attempts, errors }
 */
export async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelayMs = 500,
        maxDelayMs = 10000,
        operationName = 'operation',
        onRetry = null,
        shouldRetry = () => true,
    } = options;

    const errors = [];

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            const result = await fn(attempt);
            return { success: true, result, attempts: attempt, errors };
        } catch (err) {
            errors.push({
                attempt,
                message: err.message || String(err),
                timestamp: new Date().toISOString(),
            });

            if (attempt > maxRetries || !shouldRetry(err)) {
                console.error(`[RetryService] ${operationName} failed after ${attempt} attempt(s):`, err.message);
                return { success: false, result: null, attempts: attempt, errors };
            }

            // Exponential backoff with jitter
            const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200, maxDelayMs);
            
            if (onRetry) {
                try { onRetry(attempt, err); } catch (_) {}
            }

            console.warn(`[RetryService] ${operationName} attempt ${attempt} failed, retrying in ${Math.round(delay)}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    return { success: false, result: null, attempts: maxRetries + 1, errors };
}

/**
 * Execute multiple operations, handling partial failures gracefully.
 * Some operations may succeed while others fail.
 *
 * @param {Array<Object>} operations - [{ name, fn }]
 * @param {Object} [options] - retry options applied to each
 * @returns {Promise<Object>} - { results: { name: { success, result, error } }, allSucceeded, failedCount }
 */
export async function withPartialFailureHandling(operations, options = {}) {
    const results = {};
    let failedCount = 0;

    for (const op of operations) {
        try {
            const retryResult = await withRetry(op.fn, {
                ...options,
                operationName: op.name,
                maxRetries: options.maxRetries ?? 1,
            });

            results[op.name] = {
                success: retryResult.success,
                result: retryResult.result,
                attempts: retryResult.attempts,
                error: retryResult.success ? null : retryResult.errors[retryResult.errors.length - 1]?.message,
            };

            if (!retryResult.success) failedCount++;
        } catch (err) {
            results[op.name] = { success: false, result: null, attempts: 0, error: err.message };
            failedCount++;
        }
    }

    return {
        results,
        allSucceeded: failedCount === 0,
        failedCount,
        totalCount: operations.length,
    };
}

/**
 * Pre-built retry configurations for common operations.
 */
export const RETRY_CONFIGS = {
    dispatch: { maxRetries: 3, baseDelayMs: 1000, operationName: 'dispatch_creation' },
    invoice: { maxRetries: 2, baseDelayMs: 500, operationName: 'invoice_generation' },
    import: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 5000, operationName: 'catalog_import' },
    notification: { maxRetries: 1, baseDelayMs: 200, operationName: 'notification_send' },
    audit: { maxRetries: 1, baseDelayMs: 100, operationName: 'audit_log' },
};
