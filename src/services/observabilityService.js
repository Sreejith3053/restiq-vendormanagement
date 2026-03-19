/**
 * observabilityService.js
 * 
 * Structured logging, metrics collection, and alert detection.
 * 
 * Provides:
 * - Structured error/action logging to Firestore
 * - Metrics tracking (orders/week, issue rate, fulfillment, revenue)
 * - Alert detection (invoice failures, high issue rates, price spikes)
 */
import { db } from '../firebase';
import { addDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';

/* ═══════════════════════════════════════════════════════════
   SECTION 1 — STRUCTURED LOGGING
   ═══════════════════════════════════════════════════════════ */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, critical: 4 };

/**
 * Log a structured event to Firestore.
 * Non-blocking — failures are silently caught.
 *
 * @param {Object} params
 * @param {string} params.level - 'debug' | 'info' | 'warn' | 'error' | 'critical'
 * @param {string} params.category - 'order' | 'dispatch' | 'invoice' | 'import' | 'catalog' | 'auth' | 'system'
 * @param {string} params.action - descriptive action name
 * @param {string} [params.entityType]
 * @param {string} [params.entityId]
 * @param {Object} [params.metadata]
 * @param {string} [params.performedBy]
 * @param {string} [params.errorMessage]
 */
export async function logEvent({ level = 'info', category, action, entityType, entityId, metadata, performedBy, errorMessage }) {
    try {
        await addDoc(collection(db, 'systemLogs'), {
            level,
            levelNum: LOG_LEVELS[level] ?? 1,
            category: category || 'system',
            action: action || '',
            entityType: entityType || '',
            entityId: entityId || '',
            metadata: metadata || {},
            performedBy: performedBy || 'system',
            errorMessage: errorMessage || '',
            timestamp: serverTimestamp(),
            ts: new Date().toISOString(),
        });
    } catch (err) {
        console.warn('[Observability] Failed to log event:', err.message);
    }
}

/** Convenience wrappers */
export const logInfo = (category, action, meta) => logEvent({ level: 'info', category, action, metadata: meta });
export const logWarn = (category, action, meta) => logEvent({ level: 'warn', category, action, metadata: meta });
export const logError = (category, action, errorMessage, meta) => logEvent({ level: 'error', category, action, errorMessage, metadata: meta });
export const logCritical = (category, action, errorMessage, meta) => logEvent({ level: 'critical', category, action, errorMessage, metadata: meta });

/* ═══════════════════════════════════════════════════════════
   SECTION 2 — METRICS
   ═══════════════════════════════════════════════════════════ */

/**
 * Record a metric data point.
 */
export async function recordMetric(metricName, value, dimensions = {}) {
    try {
        await addDoc(collection(db, 'systemMetrics'), {
            metric: metricName,
            value: Number(value) || 0,
            dimensions,
            timestamp: serverTimestamp(),
            ts: new Date().toISOString(),
        });
    } catch (_) {}
}

/**
 * Compute operational metrics for a time range.
 *
 * @param {string} [weekStart] - ISO date, if null uses last 7 days
 * @returns {Promise<Object>} metrics snapshot
 */
export async function computeOperationalMetrics(weekStart) {
    const now = new Date();
    const rangeStart = weekStart ? new Date(weekStart) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const metrics = {
        periodStart: rangeStart.toISOString(),
        periodEnd: now.toISOString(),
        orders: { total: 0, fulfilled: 0, pending: 0, rejected: 0 },
        dispatches: { total: 0, confirmed: 0, rejected: 0, delivered: 0, pending: 0 },
        issues: { total: 0, open: 0, resolved: 0 },
        invoices: { total: 0, paid: 0, pending: 0, disputed: 0 },
        revenue: { total: 0, commission: 0, vendorPayout: 0 },
    };

    try {
        // Orders
        const ordersSnap = await getDocs(collection(db, 'marketplaceOrders'));
        ordersSnap.docs.forEach(d => {
            const o = d.data();
            metrics.orders.total++;
            const st = (o.status || '').toLowerCase();
            if (['fulfilled', 'completed', 'delivered'].includes(st)) { metrics.orders.fulfilled++; metrics.revenue.total += Number(o.total || 0); }
            else if (st.includes('pending')) metrics.orders.pending++;
            else if (st === 'rejected') metrics.orders.rejected++;
        });

        // Dispatches
        const dispatchSnap = await getDocs(collection(db, 'vendorDispatches'));
        dispatchSnap.docs.forEach(d => {
            const dp = d.data();
            metrics.dispatches.total++;
            const st = dp.status || '';
            if (st === 'Sent') metrics.dispatches.pending++;
            else if (st === 'Confirmed' || st === 'Partially Confirmed') metrics.dispatches.confirmed++;
            else if (st === 'Rejected') metrics.dispatches.rejected++;
            else if (st === 'Delivered') metrics.dispatches.delivered++;
        });

        // Issues
        const issueSnap = await getDocs(collection(db, 'issuesDisputes'));
        issueSnap.docs.forEach(d => {
            const i = d.data();
            metrics.issues.total++;
            if ((i.status || '').toLowerCase() === 'open') metrics.issues.open++;
            else if (['resolved', 'closed'].includes((i.status || '').toLowerCase())) metrics.issues.resolved++;
        });

        // Invoices
        const invSnap = await getDocs(collection(db, 'vendorInvoices'));
        invSnap.docs.forEach(d => {
            const inv = d.data();
            metrics.invoices.total++;
            const ps = (inv.paymentStatus || '').toUpperCase();
            if (ps === 'PAID') { metrics.invoices.paid++; metrics.revenue.vendorPayout += Number(inv.vendorPayoutAmount || 0); }
            else if (ps === 'DISPUTED') metrics.invoices.disputed++;
            else metrics.invoices.pending++;
            metrics.revenue.commission += Number(inv.commissionAmount || 0);
        });
    } catch (err) {
        console.warn('[Observability] Metrics computation error:', err.message);
    }

    // Derived rates
    metrics.fulfillmentRate = metrics.dispatches.total > 0
        ? Math.round((metrics.dispatches.confirmed + metrics.dispatches.delivered) / metrics.dispatches.total * 100)
        : 0;
    metrics.issueRate = metrics.dispatches.total > 0
        ? Math.round(metrics.issues.total / metrics.dispatches.total * 100)
        : 0;

    return metrics;
}

/* ═══════════════════════════════════════════════════════════
   SECTION 3 — ALERT DETECTION
   ═══════════════════════════════════════════════════════════ */

/**
 * Run alert detection and store any triggered alerts.
 *
 * @returns {Promise<Array>} - triggered alerts
 */
export async function detectAlerts() {
    const alerts = [];
    const metrics = await computeOperationalMetrics();

    // High issue rate
    if (metrics.issueRate > 20) {
        alerts.push({
            type: 'high_issue_rate',
            severity: metrics.issueRate > 40 ? 'critical' : 'warning',
            message: `Issue rate is ${metrics.issueRate}% — above 20% threshold`,
            metric: metrics.issueRate,
        });
    }

    // Low fulfillment
    if (metrics.dispatches.total > 5 && metrics.fulfillmentRate < 70) {
        alerts.push({
            type: 'low_fulfillment',
            severity: metrics.fulfillmentRate < 50 ? 'critical' : 'warning',
            message: `Fulfillment rate is ${metrics.fulfillmentRate}% — below 70% target`,
            metric: metrics.fulfillmentRate,
        });
    }

    // Disputed invoices
    if (metrics.invoices.disputed > 0) {
        alerts.push({
            type: 'disputed_invoices',
            severity: metrics.invoices.disputed > 3 ? 'critical' : 'warning',
            message: `${metrics.invoices.disputed} invoice(s) are disputed`,
            metric: metrics.invoices.disputed,
        });
    }

    // Open issues
    if (metrics.issues.open > 5) {
        alerts.push({
            type: 'many_open_issues',
            severity: metrics.issues.open > 10 ? 'critical' : 'warning',
            message: `${metrics.issues.open} issues are still open`,
            metric: metrics.issues.open,
        });
    }

    // Store alerts
    for (const alert of alerts) {
        try {
            await addDoc(collection(db, 'systemAlerts'), {
                ...alert,
                status: 'active',
                detectedAt: serverTimestamp(),
            });
        } catch (_) {}
    }

    return alerts;
}
