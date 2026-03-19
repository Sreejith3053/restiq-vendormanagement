/**
 * financialValidation.js
 *
 * Production-grade financial validation for the RestIQ platform.
 * Ensures invoice correctness, immutable snapshots, and reconciliation.
 *
 * Usage:
 *   import { buildInvoiceSnapshot, validateReconciliation } from '../services/financialValidation';
 */

// ── Invoice Snapshot Builder ────────────────────────────────────────────────

/**
 * Build an immutable snapshot of invoice data at creation time.
 * Freezes all prices, quantities, tax, commission so they never need recomputation.
 *
 * @param {Object} params
 * @param {string} params.restaurantId
 * @param {string} params.restaurantName
 * @param {string} params.orderId
 * @param {string} params.weekStart
 * @param {Array}  params.items - Line items with qty, price, tax info
 * @param {Object} params.taxConfig - { taxRate, taxIncluded }
 * @param {number} params.commissionPercent - Platform commission % (default 10)
 * @returns {Object} Complete invoice snapshot ready for Firestore
 */
export function buildInvoiceSnapshot({
    restaurantId,
    restaurantName,
    orderId,
    weekStart,
    items = [],
    taxConfig = {},
    commissionPercent = 10,
}) {
    const taxRate = Number(taxConfig.taxRate || 0.13); // default 13% HST
    const taxIncluded = !!taxConfig.taxIncluded;

    // Compute line-level totals
    const snapshotItems = items.map(item => {
        const qty = Number(item.qty || item.quantity || 1);
        const unitPrice = Number(item.vendorPrice || item.price || 0);
        const isTaxable = item.isTaxable !== undefined ? !!item.isTaxable : !!item.taxable;

        let lineSubtotal, lineTax;
        if (taxIncluded && isTaxable) {
            lineSubtotal = (unitPrice * qty) / (1 + taxRate);
            lineTax = (unitPrice * qty) - lineSubtotal;
        } else {
            lineSubtotal = unitPrice * qty;
            lineTax = isTaxable ? lineSubtotal * taxRate : 0;
        }

        const lineTotal = lineSubtotal + lineTax;
        const lineCommission = lineSubtotal * (commissionPercent / 100);
        const lineVendorPayout = lineSubtotal - lineCommission;

        return {
            // Identity snapshot
            itemName: item.itemName || item.name || 'Unknown',
            vendorItemId: item.vendorItemId || null,
            catalogItemId: item.catalogItemId || null,
            category: item.category || null,
            unit: item.unit || item.baseUnit || 'unit',

            // Quantity + pricing snapshot (frozen at creation)
            qty,
            unitPrice,
            isTaxable,

            // Computed totals (frozen)
            lineSubtotal: round2(lineSubtotal),
            lineTax: round2(lineTax),
            lineTotal: round2(lineTotal),
            lineCommission: round2(lineCommission),
            lineVendorPayout: round2(lineVendorPayout),
        };
    });

    // Aggregate totals
    const subtotal = round2(snapshotItems.reduce((s, i) => s + i.lineSubtotal, 0));
    const totalTax = round2(snapshotItems.reduce((s, i) => s + i.lineTax, 0));
    const grandTotal = round2(subtotal + totalTax);
    const totalCommission = round2(snapshotItems.reduce((s, i) => s + i.lineCommission, 0));
    const totalVendorPayout = round2(snapshotItems.reduce((s, i) => s + i.lineVendorPayout, 0));

    // Self-check: subtotal should equal commission + vendor payout
    const reconcilesDelta = Math.abs(subtotal - (totalCommission + totalVendorPayout));
    const reconciles = reconcilesDelta < 0.02; // allow 2 cent rounding tolerance

    return {
        // Metadata
        restaurantId,
        restaurantName: restaurantName || restaurantId,
        orderId: orderId || null,
        weekStart: weekStart || null,
        invoiceType: 'restaurant',
        commissionPercent,
        taxRate,
        taxIncluded,

        // Frozen line items
        items: snapshotItems,
        itemCount: snapshotItems.length,

        // Frozen totals
        subtotal,
        totalTax,
        grandTotal,
        totalCommission,
        totalVendorPayout,

        // Reconciliation check
        _reconciles: reconciles,
        _reconcileDelta: round2(reconcilesDelta),

        // Audit
        _snapshotVersion: 1,
        _snapshotCreatedAt: new Date().toISOString(),
    };
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Validate that invoices reconcile: billing = payouts + commission.
 *
 * @param {Array} invoices - Array of invoice objects (must have grandTotal, totalVendorPayout, totalCommission)
 * @param {Object} [options]
 * @param {number} [options.tolerance=0.05] - Acceptable rounding tolerance per invoice
 * @returns {{ reconciles: boolean, totalBilling: number, totalPayouts: number, totalCommission: number, delta: number, mismatches: Array }}
 */
export function validateReconciliation(invoices = [], options = {}) {
    const { tolerance = 0.05 } = options;
    const mismatches = [];

    let totalBilling = 0;
    let totalPayouts = 0;
    let totalCommission = 0;

    invoices.forEach((inv, idx) => {
        const billing = Number(inv.grandTotal || inv.subtotal || 0);
        const payout = Number(inv.totalVendorPayout || inv.vendorPayoutTotal || inv.netVendorPayable || 0);
        const commission = Number(inv.totalCommission || inv.commissionAmount || inv.marketplaceCommissionTotal || 0);
        const tax = Number(inv.totalTax || inv.totalTaxAmount || 0);

        totalBilling += billing;
        totalPayouts += payout;
        totalCommission += commission;

        // Check: subtotal (pre-tax) should = payout + commission
        const subtotal = billing - tax;
        const delta = Math.abs(subtotal - (payout + commission));

        if (delta > tolerance) {
            mismatches.push({
                invoiceId: inv.id || inv.invoiceNumber || `idx-${idx}`,
                restaurantId: inv.restaurantId,
                billing: round2(billing),
                payout: round2(payout),
                commission: round2(commission),
                tax: round2(tax),
                delta: round2(delta),
                message: `Subtotal $${round2(subtotal)} ≠ Payout $${round2(payout)} + Commission $${round2(commission)} (Δ $${round2(delta)})`,
            });
        }
    });

    const overallDelta = Math.abs((totalBilling - totalCommission) - totalPayouts);

    return {
        reconciles: mismatches.length === 0 && overallDelta < tolerance * invoices.length,
        totalBilling: round2(totalBilling),
        totalPayouts: round2(totalPayouts),
        totalCommission: round2(totalCommission),
        delta: round2(overallDelta),
        mismatches,
        invoiceCount: invoices.length,
    };
}

// ── Payment Validation ──────────────────────────────────────────────────────

/**
 * Validate that an invoice can be created for an order.
 * Checks: order must be in a finalized state.
 *
 * @param {Object} order
 * @returns {{ valid: boolean, error?: string }}
 */
export function canCreateInvoice(order) {
    if (!order) return { valid: false, error: 'Order is required' };

    const status = (order.status || order.orderStatus || '').toLowerCase();
    const finalizedStates = ['delivered', 'fulfilled', 'closed', 'confirmed', 'vendor_confirmed', 'warehouse_ready'];

    if (!finalizedStates.includes(status)) {
        return {
            valid: false,
            error: `Cannot create invoice: order status is "${status}". Must be in a finalized state (${finalizedStates.join(', ')}).`,
        };
    }

    return { valid: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}
