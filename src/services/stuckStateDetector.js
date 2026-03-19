/**
 * stuckStateDetector.js
 *
 * Detects orders/dispatches stuck in intermediate states and SLA breaches.
 * Surface alerts in Control Tower → Exceptions tab.
 *
 * Usage:
 *   import { detectStuckOrders, detectSLABreaches } from '../services/stuckStateDetector';
 *   const stuckAlerts = detectStuckOrders(orders);
 *   const slaAlerts = detectSLABreaches(dispatches);
 */

// ── Default SLA Thresholds (hours) ──────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
    submitted_not_aggregated: 24,      // 24h to aggregate after submission
    aggregated_not_dispatched: 12,     // 12h to dispatch after aggregation
    sent_not_confirmed: 4,            // 4h for vendor to confirm
    confirmed_not_warehouse: 8,       // 8h to create warehouse picks
    warehouse_not_delivered: 24,      // 24h delivery window
    issue_unresolved: 48,            // 48h to resolve an issue
};

// ── Stuck State Detection ───────────────────────────────────────────────────

/**
 * Detect orders stuck in intermediate states beyond threshold times.
 *
 * @param {Array} orders - Array of order objects with { id, status, updatedAt, createdAt }
 * @param {Object} [thresholds] - Override thresholds in hours
 * @returns {Array<{ id: string, status: string, stuckHours: number, severity: string, message: string }>}
 */
export function detectStuckOrders(orders = [], thresholds = {}) {
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const now = Date.now();
    const alerts = [];

    const stuckChecks = [
        { status: 'submitted',          threshold: t.submitted_not_aggregated,    nextExpected: 'aggregated',       message: 'submitted but not yet aggregated' },
        { status: 'aggregated',         threshold: t.aggregated_not_dispatched,   nextExpected: 'sent_to_vendor',   message: 'aggregated but not dispatched' },
        { status: 'sent_to_vendor',     threshold: t.sent_not_confirmed,         nextExpected: 'vendor_confirmed', message: 'sent to vendor but not confirmed' },
        { status: 'vendor_confirmed',   threshold: t.confirmed_not_warehouse,    nextExpected: 'warehouse_ready',  message: 'confirmed but no warehouse picks' },
        { status: 'warehouse_ready',    threshold: t.warehouse_not_delivered,     nextExpected: 'delivered',        message: 'warehouse ready but not delivered' },
        { status: 'issue_open',         threshold: t.issue_unresolved,           nextExpected: 'closed',           message: 'issue open for too long' },
    ];

    for (const order of orders) {
        const orderStatus = (order.status || order.orderStatus || '').toLowerCase().trim();
        const updatedAt = toMs(order.updatedAt || order.createdAt);

        if (!updatedAt) continue;

        for (const check of stuckChecks) {
            if (orderStatus === check.status) {
                const hoursStuck = (now - updatedAt) / (1000 * 60 * 60);

                if (hoursStuck > check.threshold) {
                    const severity = hoursStuck > check.threshold * 2 ? 'critical'
                        : hoursStuck > check.threshold * 1.5 ? 'high'
                        : 'medium';

                    alerts.push({
                        id: order.id,
                        entityType: 'order',
                        status: orderStatus,
                        stuckHours: Math.round(hoursStuck),
                        threshold: check.threshold,
                        severity,
                        nextExpected: check.nextExpected,
                        message: `Order ${order.id?.slice(-6) || '?'} ${check.message} for ${Math.round(hoursStuck)}h (SLA: ${check.threshold}h)`,
                    });
                }
                break;
            }
        }
    }

    return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/**
 * Detect dispatches stuck in intermediate states.
 *
 * @param {Array} dispatches - Array of dispatch route objects with { routeDispatchId, status, sentAt, confirmedAt }
 * @param {Object} [thresholds]
 * @returns {Array<{ id: string, status: string, stuckHours: number, severity: string, message: string }>}
 */
export function detectStuckDispatches(dispatches = [], thresholds = {}) {
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const now = Date.now();
    const alerts = [];

    for (const d of dispatches) {
        const status = (d.status || '').trim();

        if (status === 'Sent') {
            const sentAt = toMs(d.sentAt);
            if (sentAt) {
                const hours = (now - sentAt) / (1000 * 60 * 60);
                if (hours > t.sent_not_confirmed) {
                    alerts.push({
                        id: d.routeDispatchId || d.id,
                        entityType: 'dispatch',
                        status,
                        stuckHours: Math.round(hours),
                        threshold: t.sent_not_confirmed,
                        severity: hours > t.sent_not_confirmed * 3 ? 'critical' : hours > t.sent_not_confirmed * 2 ? 'high' : 'medium',
                        message: `Dispatch to ${d.vendorName || '?'} (${d.routeDay || '?'}) sent ${Math.round(hours)}h ago — no vendor confirmation (SLA: ${t.sent_not_confirmed}h)`,
                    });
                }
            }
        }

        if (status === 'Confirmed' || status === 'Partially Confirmed') {
            const confirmedAt = toMs(d.confirmedAt);
            if (confirmedAt) {
                const hours = (now - confirmedAt) / (1000 * 60 * 60);
                if (hours > t.confirmed_not_warehouse) {
                    alerts.push({
                        id: d.routeDispatchId || d.id,
                        entityType: 'dispatch',
                        status,
                        stuckHours: Math.round(hours),
                        threshold: t.confirmed_not_warehouse,
                        severity: hours > t.confirmed_not_warehouse * 2 ? 'high' : 'medium',
                        message: `Dispatch to ${d.vendorName || '?'} confirmed ${Math.round(hours)}h ago — not in warehouse (SLA: ${t.confirmed_not_warehouse}h)`,
                    });
                }
            }
        }
    }

    return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

// ── SLA Breach Detection ────────────────────────────────────────────────────

/**
 * Detect SLA breaches for vendor confirmation and delivery windows.
 *
 * @param {Array} dispatches
 * @param {Object} [slaConfig]
 * @param {number} [slaConfig.confirmationHours=4] - Max hours for vendor to confirm
 * @param {number} [slaConfig.deliveryHours=24] - Max hours from confirmed to delivered
 * @returns {{ atRisk: Array, breached: Array, summary: { totalChecked: number, atRiskCount: number, breachedCount: number }}}
 */
export function detectSLABreaches(dispatches = [], slaConfig = {}) {
    const { confirmationHours = 4, deliveryHours = 24 } = slaConfig;
    const now = Date.now();
    const atRisk = [];
    const breached = [];

    for (const d of dispatches) {
        const status = (d.status || '').trim();

        // Confirmation SLA check
        if (status === 'Sent') {
            const sentAt = toMs(d.sentAt);
            if (sentAt) {
                const hours = (now - sentAt) / (1000 * 60 * 60);
                const remaining = confirmationHours - hours;

                if (remaining < 0) {
                    breached.push({
                        id: d.routeDispatchId || d.id,
                        type: 'confirmation',
                        vendorName: d.vendorName,
                        routeDay: d.routeDay,
                        hoursOverdue: Math.round(Math.abs(remaining)),
                        message: `${d.vendorName} has not confirmed ${d.routeDay} dispatch — ${Math.round(Math.abs(remaining))}h overdue`,
                    });
                } else if (remaining < confirmationHours * 0.25) {
                    atRisk.push({
                        id: d.routeDispatchId || d.id,
                        type: 'confirmation',
                        vendorName: d.vendorName,
                        routeDay: d.routeDay,
                        hoursRemaining: Math.round(remaining),
                        message: `${d.vendorName} ${d.routeDay} confirmation due in ${Math.round(remaining)}h`,
                    });
                }
            }
        }

        // Delivery SLA check
        if (status === 'Confirmed' || status === 'Warehouse Ready') {
            const confirmedAt = toMs(d.confirmedAt || d.updatedAt);
            if (confirmedAt) {
                const hours = (now - confirmedAt) / (1000 * 60 * 60);
                const remaining = deliveryHours - hours;

                if (remaining < 0) {
                    breached.push({
                        id: d.routeDispatchId || d.id,
                        type: 'delivery',
                        vendorName: d.vendorName,
                        routeDay: d.routeDay,
                        hoursOverdue: Math.round(Math.abs(remaining)),
                        message: `${d.vendorName} ${d.routeDay} delivery — ${Math.round(Math.abs(remaining))}h overdue`,
                    });
                } else if (remaining < deliveryHours * 0.25) {
                    atRisk.push({
                        id: d.routeDispatchId || d.id,
                        type: 'delivery',
                        vendorName: d.vendorName,
                        routeDay: d.routeDay,
                        hoursRemaining: Math.round(remaining),
                        message: `${d.vendorName} ${d.routeDay} delivery due in ${Math.round(remaining)}h`,
                    });
                }
            }
        }
    }

    return {
        atRisk,
        breached,
        summary: {
            totalChecked: dispatches.length,
            atRiskCount: atRisk.length,
            breachedCount: breached.length,
        },
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toMs(ts) {
    if (!ts) return null;
    if (ts.toDate && typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'string') { const d = new Date(ts); return isNaN(d) ? null : d.getTime(); }
    if (typeof ts === 'number') return ts;
    return null;
}

function severityRank(s) {
    return { critical: 3, high: 2, medium: 1, low: 0 }[s] || 0;
}
