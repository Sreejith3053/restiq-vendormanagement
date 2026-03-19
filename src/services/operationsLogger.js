/**
 * operationsLogger.js
 *
 * Structured logging and metrics utility for the RestIQ platform.
 * Provides consistent logging format, error capture, and KPI tracking.
 *
 * Usage:
 *   import { ops } from '../services/operationsLogger';
 *   ops.info('invoice_created', { invoiceId, amount });
 *   ops.error('dispatch_failed', error, { vendorId });
 *   ops.metric('orders_submitted', 5, { week: '2026-03-18' });
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LOG_LEVELS.info; // Change to 'debug' for development

// ── Structured Logger ───────────────────────────────────────────────────────

function formatLog(level, action, details, error) {
    const timestamp = new Date().toISOString();
    const prefix = `[RestIQ:${level.toUpperCase()}]`;
    return { timestamp, level, action, details, error: error?.message || null, prefix };
}

/**
 * Operations logger with structured output.
 */
export const ops = {
    /**
     * Debug-level log (suppressed in production).
     */
    debug(action, details = {}) {
        if (LOG_LEVELS.debug >= MIN_LEVEL) {
            const log = formatLog('debug', action, details);
            console.debug(`${log.prefix} ${action}`, details);
        }
    },

    /**
     * Info-level log for key operations.
     */
    info(action, details = {}) {
        if (LOG_LEVELS.info >= MIN_LEVEL) {
            const log = formatLog('info', action, details);
            console.info(`${log.prefix} ${action}`, details);
        }
    },

    /**
     * Warning-level log for potential issues.
     */
    warn(action, details = {}) {
        if (LOG_LEVELS.warn >= MIN_LEVEL) {
            const log = formatLog('warn', action, details);
            console.warn(`${log.prefix} ${action}`, details);
        }
    },

    /**
     * Error-level log with stack capture.
     */
    error(action, error, context = {}) {
        const log = formatLog('error', action, context, error);
        console.error(`${log.prefix} ${action}`, { error: error?.message, stack: error?.stack, ...context });

        // Store in error buffer for observability
        errorBuffer.push({
            ...log,
            stack: error?.stack,
            context,
        });

        // Keep buffer bounded
        if (errorBuffer.length > MAX_BUFFER) {
            errorBuffer.splice(0, errorBuffer.length - MAX_BUFFER);
        }
    },

    /**
     * Track a numeric metric.
     */
    metric(name, value, tags = {}) {
        const entry = {
            name,
            value: Number(value),
            tags,
            timestamp: Date.now(),
        };
        metricsBuffer.push(entry);

        // Keep buffer bounded
        if (metricsBuffer.length > MAX_BUFFER) {
            metricsBuffer.splice(0, metricsBuffer.length - MAX_BUFFER);
        }

        if (LOG_LEVELS.debug >= MIN_LEVEL) {
            console.debug(`[RestIQ:METRIC] ${name}=${value}`, tags);
        }
    },

    /**
     * Get recent errors for debugging.
     * @param {number} count
     * @returns {Array}
     */
    getRecentErrors(count = 10) {
        return errorBuffer.slice(-count);
    },

    /**
     * Get recent metrics for observability.
     * @param {string} [name] - Filter by metric name
     * @returns {Array}
     */
    getRecentMetrics(name) {
        const items = name ? metricsBuffer.filter(m => m.name === name) : metricsBuffer;
        return items.slice(-50);
    },

    /**
     * Get a summary of tracked metrics.
     * @returns {Object} - { metricName: { count, total, avg, min, max } }
     */
    getMetricsSummary() {
        const summary = {};
        for (const m of metricsBuffer) {
            if (!summary[m.name]) {
                summary[m.name] = { count: 0, total: 0, min: Infinity, max: -Infinity };
            }
            summary[m.name].count++;
            summary[m.name].total += m.value;
            summary[m.name].min = Math.min(summary[m.name].min, m.value);
            summary[m.name].max = Math.max(summary[m.name].max, m.value);
        }
        for (const key of Object.keys(summary)) {
            summary[key].avg = summary[key].count > 0
                ? Math.round((summary[key].total / summary[key].count) * 100) / 100
                : 0;
        }
        return summary;
    },

    /**
     * Clear all buffers.
     */
    reset() {
        errorBuffer.length = 0;
        metricsBuffer.length = 0;
    },
};

// ── Internal Buffers ────────────────────────────────────────────────────────

const MAX_BUFFER = 100;
const errorBuffer = [];
const metricsBuffer = [];

// ── Action Timer ────────────────────────────────────────────────────────────

/**
 * Time an async operation and log the result.
 *
 * @param {string} action - Name of the operation
 * @param {Function} fn - Async function to execute
 * @returns {Promise<any>} - Result of fn
 */
export async function timedOperation(action, fn) {
    const start = performance.now();
    try {
        const result = await fn();
        const ms = Math.round(performance.now() - start);
        ops.info(`${action}_completed`, { durationMs: ms });
        ops.metric(`${action}_duration_ms`, ms);
        return result;
    } catch (err) {
        const ms = Math.round(performance.now() - start);
        ops.error(`${action}_failed`, err, { durationMs: ms });
        throw err;
    }
}
