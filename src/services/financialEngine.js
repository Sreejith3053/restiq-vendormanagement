/**
 * financialEngine.js
 * 
 * Enterprise-grade financial system for RestIQ platform.
 * 
 * Provides:
 * 1. Immutable invoice snapshot creation
 * 2. Invoice adjustment/correction records
 * 3. Payout lifecycle management (Draft → Generated → Pending → Paid → On Hold → Disputed)
 * 4. Weekly reconciliation engine 
 * 5. Financial audit trail integration
 */
import { db } from '../firebase';
import {
    doc, setDoc, addDoc, getDoc, getDocs, updateDoc,
    collection, query, where, serverTimestamp, Timestamp,
} from 'firebase/firestore';

/* ═══════════════════════════════════════════════════════════
   SECTION 1 — IMMUTABLE INVOICE SNAPSHOTS
   ═══════════════════════════════════════════════════════════ */

/**
 * Create an immutable invoice snapshot.
 * Once created, the snapshot fields NEVER change.
 * Any correction must use createInvoiceAdjustment().
 *
 * @param {Object} params
 * @param {string} params.vendorId
 * @param {string} params.vendorName
 * @param {string} params.weekStart - ISO date string (e.g. '2026-03-17')
 * @param {string} params.dispatchId - reference dispatch
 * @param {Array}  params.items - [{ itemName, qty, unitPrice, lineTotal, packSize, unit }]
 * @param {number} params.subtotal
 * @param {number} params.tax
 * @param {number} params.commissionRate - e.g. 0.15 for 15%
 * @param {number} params.commissionAmount
 * @param {number} params.vendorPayoutAmount
 * @param {number} params.totalBilled - total charged to restaurant
 * @param {string} params.restaurantId
 * @param {string} params.restaurantName
 * @param {string} [params.createdBy='system']
 * @returns {Promise<Object>} - { invoiceId, invoiceNumber }
 */
export async function createImmutableInvoice({
    vendorId, vendorName, weekStart, dispatchId,
    items, subtotal, tax = 0,
    commissionRate = 0.15, commissionAmount, vendorPayoutAmount,
    totalBilled, restaurantId, restaurantName,
    createdBy = 'system',
}) {
    // Validate required fields
    if (!vendorId) throw new Error('vendorId is required');
    if (!items || items.length === 0) throw new Error('items are required');
    if (typeof subtotal !== 'number' || subtotal < 0) throw new Error('Invalid subtotal');

    // Compute if not provided
    const computedCommission = commissionAmount ?? Math.round(subtotal * commissionRate * 100) / 100;
    const computedPayout = vendorPayoutAmount ?? Math.round((subtotal - computedCommission) * 100) / 100;
    const computedTotal = totalBilled ?? Math.round((subtotal + tax) * 100) / 100;

    // Generate invoice number
    const prefix = 'INV';
    const dateSegment = (weekStart || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const invoiceNumber = `${prefix}-${dateSegment}-${random}`;

    // Freeze item snapshots — deep copy with computed line totals
    const frozenItems = items.map(item => ({
        itemName: item.itemName || item.name || '',
        itemId: item.itemId || item.id || '',
        qty: Number(item.qty) || 0,
        unitPrice: Number(item.unitPrice || item.vendorPrice || item.price) || 0,
        lineTotal: Number(item.lineTotal) || (Number(item.qty || 0) * Number(item.unitPrice || item.vendorPrice || item.price || 0)),
        packSize: item.packSize || '',
        unit: item.unit || '',
        category: item.category || '',
    }));

    const invoice = {
        // Identity
        invoiceNumber,
        vendorId,
        vendorName: vendorName || '',
        restaurantId: restaurantId || '',
        restaurantName: restaurantName || '',
        dispatchId: dispatchId || '',
        weekStart: weekStart || '',

        // Financial snapshot (IMMUTABLE after creation)
        snapshotItems: frozenItems,
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        commissionRate,
        commissionAmount: computedCommission,
        vendorPayoutAmount: computedPayout,
        totalBilled: computedTotal,

        // Lifecycle
        invoiceStatus: 'generated', // generated | sent | disputed | paid | voided
        paymentStatus: 'PENDING',   // PENDING | PAID | ON_HOLD | DISPUTED
        payoutLifecycle: 'generated', // draft | generated | pending_payment | paid | on_hold | disputed

        // Metadata
        isImmutable: true,
        version: 1,
        adjustmentIds: [], // references to adjustment records
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, 'vendorInvoices'), invoice);

    // Audit log
    try {
        await addDoc(collection(db, 'adminChangeLogs'), {
            entityType: 'invoice',
            entityId: docRef.id,
            action: 'invoice_created',
            changedBy: createdBy,
            afterState: { invoiceNumber, subtotal, commissionAmount: computedCommission, vendorPayoutAmount: computedPayout },
            timestamp: serverTimestamp(),
        });
    } catch (_) {}

    return { invoiceId: docRef.id, invoiceNumber };
}

/**
 * Create an adjustment record for an existing invoice.
 * The original invoice is NEVER modified — adjustments are additive.
 *
 * @param {Object} params
 * @param {string} params.originalInvoiceId
 * @param {string} params.reason - 'price_correction' | 'quantity_correction' | 'refund' | 'credit_note' | 'other'
 * @param {number} params.adjustmentAmount - positive = vendor owes more, negative = platform owes vendor
 * @param {Array}  [params.adjustedItems] - items that changed
 * @param {string} [params.notes]
 * @param {string} [params.createdBy='admin']
 */
export async function createInvoiceAdjustment({
    originalInvoiceId, reason, adjustmentAmount,
    adjustedItems = [], notes = '', createdBy = 'admin',
}) {
    if (!originalInvoiceId) throw new Error('originalInvoiceId is required');

    // Verify original exists
    const origRef = doc(db, 'vendorInvoices', originalInvoiceId);
    const origSnap = await getDoc(origRef);
    if (!origSnap.exists()) throw new Error('Original invoice not found');

    const origData = origSnap.data();

    const adjustment = {
        type: 'adjustment',
        originalInvoiceId,
        originalInvoiceNumber: origData.invoiceNumber || '',
        vendorId: origData.vendorId,
        reason,
        adjustmentAmount: Math.round((adjustmentAmount || 0) * 100) / 100,
        adjustedItems,
        notes,
        status: 'pending', // pending | approved | applied | rejected
        createdBy,
        createdAt: serverTimestamp(),
    };

    const adjRef = await addDoc(collection(db, 'invoiceAdjustments'), adjustment);

    // Link adjustment to original invoice (append to array)
    await updateDoc(origRef, {
        adjustmentIds: [...(origData.adjustmentIds || []), adjRef.id],
        updatedAt: serverTimestamp(),
    });

    return { adjustmentId: adjRef.id };
}

/* ═══════════════════════════════════════════════════════════
   SECTION 2 — PAYOUT LIFECYCLE
   ═══════════════════════════════════════════════════════════ */

const VALID_PAYOUT_TRANSITIONS = {
    draft:            ['generated'],
    generated:        ['pending_payment', 'on_hold', 'disputed'],
    pending_payment:  ['paid', 'on_hold', 'disputed'],
    paid:             [],  // terminal
    on_hold:          ['pending_payment', 'disputed'],
    disputed:         ['pending_payment', 'on_hold', 'resolved'],
};

/**
 * Transition an invoice's payout lifecycle.
 *
 * @param {string} invoiceId
 * @param {string} newStatus
 * @param {Object} [metadata] - { paymentDate, paymentReference, notes }
 * @param {string} [performedBy='admin']
 */
export async function transitionPayoutStatus(invoiceId, newStatus, metadata = {}, performedBy = 'admin') {
    const ref = doc(db, 'vendorInvoices', invoiceId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Invoice not found');

    const data = snap.data();
    const currentStatus = data.payoutLifecycle || 'generated';
    const allowed = VALID_PAYOUT_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
        throw new Error(`Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed: ${allowed.join(', ')}`);
    }

    const update = {
        payoutLifecycle: newStatus,
        updatedAt: serverTimestamp(),
    };

    // Map to paymentStatus for backward compatibility
    if (newStatus === 'paid') {
        update.paymentStatus = 'PAID';
        update.paidAt = serverTimestamp();
        if (metadata.paymentDate) update.paymentDate = metadata.paymentDate;
        if (metadata.paymentReference) update.paymentReference = metadata.paymentReference;
    } else if (newStatus === 'on_hold') {
        update.paymentStatus = 'ON_HOLD';
    } else if (newStatus === 'disputed') {
        update.paymentStatus = 'DISPUTED';
    } else if (newStatus === 'pending_payment') {
        update.paymentStatus = 'PENDING';
    }

    if (metadata.notes) update.payoutNotes = metadata.notes;

    await updateDoc(ref, update);

    // Audit trail
    try {
        await addDoc(collection(db, 'adminChangeLogs'), {
            entityType: 'invoice',
            entityId: invoiceId,
            action: 'payout_status_changed',
            changedBy: performedBy,
            changedFields: { payoutLifecycle: { from: currentStatus, to: newStatus } },
            metadata: metadata || {},
            timestamp: serverTimestamp(),
        });
    } catch (_) {}

    return { previousStatus: currentStatus, newStatus };
}

/* ═══════════════════════════════════════════════════════════
   SECTION 3 — RECONCILIATION ENGINE
   ═══════════════════════════════════════════════════════════ */

/**
 * Run reconciliation for a given week.
 * Compares: Total Restaurant Billing = Total Vendor Payouts + Platform Commission
 * 
 * @param {string} weekStart - ISO date string
 * @returns {Promise<Object>} - reconciliation report
 */
export async function runReconciliation(weekStart) {
    if (!weekStart) throw new Error('weekStart is required');

    // Fetch all invoices for the week
    const invQ = query(collection(db, 'vendorInvoices'), where('weekStart', '==', weekStart));
    const invSnap = await getDocs(invQ);

    let totalBilled = 0;
    let totalVendorPayout = 0;
    let totalCommission = 0;
    let totalTax = 0;
    const invoiceCount = invSnap.size;
    const discrepancies = [];

    invSnap.docs.forEach(d => {
        const inv = d.data();
        const billed = Number(inv.totalBilled || inv.subtotal || 0);
        const payout = Number(inv.vendorPayoutAmount || inv.totalVendorAmount || 0);
        const commission = Number(inv.commissionAmount || 0);
        const tax = Number(inv.tax || 0);

        totalBilled += billed;
        totalVendorPayout += payout;
        totalCommission += commission;
        totalTax += tax;

        // Per-invoice check
        const expectedBilled = Math.round((payout + commission + tax) * 100) / 100;
        const actualBilled = Math.round(billed * 100) / 100;
        if (Math.abs(expectedBilled - actualBilled) > 0.01) {
            discrepancies.push({
                invoiceId: d.id,
                invoiceNumber: inv.invoiceNumber || '',
                vendorId: inv.vendorId || '',
                expected: expectedBilled,
                actual: actualBilled,
                difference: Math.round((actualBilled - expectedBilled) * 100) / 100,
                type: 'invoice_mismatch',
            });
        }
    });

    // Global check: Total billing = vendor payouts + commissions + tax
    const globalExpected = Math.round((totalVendorPayout + totalCommission + totalTax) * 100) / 100;
    const globalActual = Math.round(totalBilled * 100) / 100;
    const globalDiff = Math.round((globalActual - globalExpected) * 100) / 100;
    const isBalanced = Math.abs(globalDiff) <= 0.01;

    const report = {
        weekStart,
        runAt: new Date().toISOString(),
        invoiceCount,
        totalBilled: globalActual,
        totalVendorPayout: Math.round(totalVendorPayout * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        globalDifference: globalDiff,
        isBalanced,
        discrepancies,
        status: isBalanced && discrepancies.length === 0 ? 'clean' : 'flagged',
    };

    // Store reconciliation report
    try {
        await addDoc(collection(db, 'reconciliationReports'), {
            ...report,
            createdAt: serverTimestamp(),
        });
    } catch (err) {
        console.warn('[Reconciliation] Failed to store report:', err.message);
    }

    // If discrepancies, log to exceptions
    if (!isBalanced || discrepancies.length > 0) {
        try {
            await addDoc(collection(db, 'systemExceptions'), {
                type: 'reconciliation_mismatch',
                weekStart,
                globalDifference: globalDiff,
                discrepancyCount: discrepancies.length,
                severity: Math.abs(globalDiff) > 100 ? 'critical' : 'warning',
                status: 'open',
                createdAt: serverTimestamp(),
            });
        } catch (_) {}
    }

    return report;
}

/* ═══════════════════════════════════════════════════════════
   SECTION 4 — HELPERS
   ═══════════════════════════════════════════════════════════ */

/**
 * Get payout summary for a vendor.
 */
export async function getVendorPayoutSummary(vendorId) {
    const q = query(collection(db, 'vendorInvoices'), where('vendorId', '==', vendorId));
    const snap = await getDocs(q);

    let totalPaid = 0, totalPending = 0, totalOnHold = 0, totalDisputed = 0;
    const invoices = [];

    snap.docs.forEach(d => {
        const inv = d.data();
        const amt = Number(inv.vendorPayoutAmount || inv.totalVendorAmount || 0);
        const lifecycle = inv.payoutLifecycle || 'generated';

        if (lifecycle === 'paid') totalPaid += amt;
        else if (lifecycle === 'on_hold') totalOnHold += amt;
        else if (lifecycle === 'disputed') totalDisputed += amt;
        else totalPending += amt;

        invoices.push({ id: d.id, ...inv });
    });

    return {
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        totalOnHold: Math.round(totalOnHold * 100) / 100,
        totalDisputed: Math.round(totalDisputed * 100) / 100,
        invoiceCount: invoices.length,
        invoices,
    };
}
