/**
 * financeDisputeService.js
 * 
 * Handles invoice/financial disputes between vendors and platform.
 * 
 * Dispute lifecycle: open → reviewing → resolved / rejected
 * Links to invoices and payout records.
 */
import { db } from '../firebase';
import { addDoc, doc, getDoc, updateDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';

const DISPUTE_STATUSES = ['open', 'reviewing', 'resolved', 'rejected'];
const DISPUTE_REASONS = [
    'incorrect_amount', 'missing_items', 'wrong_commission',
    'duplicate_invoice', 'delivery_not_completed', 'quality_issue',
    'pricing_discrepancy', 'other',
];

/**
 * Create a finance dispute against an invoice.
 *
 * @param {Object} params
 * @param {string} params.invoiceId
 * @param {string} params.vendorId
 * @param {string} params.reason - one of DISPUTE_REASONS
 * @param {string} params.description - detailed explanation
 * @param {number} [params.disputedAmount] - amount being disputed
 * @param {Array}  [params.disputedItems] - specific items in question
 * @param {string} [params.createdBy='vendor']
 * @returns {Promise<Object>} - { disputeId }
 */
export async function createFinanceDispute({
    invoiceId, vendorId, reason, description,
    disputedAmount, disputedItems = [], createdBy = 'vendor',
}) {
    if (!invoiceId) throw new Error('invoiceId is required');
    if (!vendorId) throw new Error('vendorId is required');
    if (!reason) throw new Error('reason is required');

    // Verify invoice exists
    const invRef = doc(db, 'vendorInvoices', invoiceId);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) throw new Error('Invoice not found');
    const invData = invSnap.data();

    const dispute = {
        type: 'finance_dispute',
        invoiceId,
        invoiceNumber: invData.invoiceNumber || '',
        vendorId,
        vendorName: invData.vendorName || '',
        reason,
        description: description || '',
        disputedAmount: disputedAmount != null ? Math.round(disputedAmount * 100) / 100 : null,
        disputedItems,
        originalAmount: Number(invData.vendorPayoutAmount || invData.totalVendorAmount || 0),

        // Lifecycle
        status: 'open',
        resolution: null,           // 'adjusted' | 'refunded' | 'upheld' | 'partial_adjustment'
        resolutionNotes: '',
        resolvedBy: null,
        resolvedAt: null,

        // Metadata
        responses: [],              // { by, note, timestamp }
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    const disputeRef = await addDoc(collection(db, 'financeDisputes'), dispute);

    // Mark invoice as disputed
    await updateDoc(invRef, {
        payoutLifecycle: 'disputed',
        paymentStatus: 'DISPUTED',
        updatedAt: serverTimestamp(),
    });

    // Audit
    try {
        await addDoc(collection(db, 'adminChangeLogs'), {
            entityType: 'dispute',
            entityId: disputeRef.id,
            action: 'dispute_created',
            changedBy: createdBy,
            metadata: { invoiceId, reason, disputedAmount },
            timestamp: serverTimestamp(),
        });
    } catch (_) {}

    return { disputeId: disputeRef.id };
}

/**
 * Add a response to a dispute.
 */
export async function addDisputeResponse(disputeId, { note, respondedBy = 'admin' }) {
    const ref = doc(db, 'financeDisputes', disputeId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Dispute not found');

    const data = snap.data();
    const responses = [...(data.responses || [])];
    responses.push({
        by: respondedBy,
        note: note || '',
        timestamp: new Date().toISOString(),
    });

    await updateDoc(ref, {
        responses,
        status: data.status === 'open' ? 'reviewing' : data.status,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Resolve a dispute.
 *
 * @param {string} disputeId
 * @param {Object} params
 * @param {string} params.resolution - 'adjusted' | 'refunded' | 'upheld' | 'partial_adjustment'
 * @param {string} params.notes
 * @param {number} [params.adjustmentAmount] - if adjustment, the amount
 * @param {string} [params.resolvedBy='admin']
 */
export async function resolveDispute(disputeId, { resolution, notes, adjustmentAmount, resolvedBy = 'admin' }) {
    const ref = doc(db, 'financeDisputes', disputeId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Dispute not found');

    const data = snap.data();

    await updateDoc(ref, {
        status: 'resolved',
        resolution,
        resolutionNotes: notes || '',
        resolvedBy,
        resolvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    // If resolved with adjustment, create adjustment record
    if (resolution === 'adjusted' || resolution === 'partial_adjustment') {
        if (adjustmentAmount && data.invoiceId) {
            try {
                const { createInvoiceAdjustment } = await import('./financialEngine');
                await createInvoiceAdjustment({
                    originalInvoiceId: data.invoiceId,
                    reason: 'dispute_resolution',
                    adjustmentAmount,
                    notes: `Dispute ${disputeId} resolved: ${notes || ''}`,
                    createdBy: resolvedBy,
                });
            } catch (err) {
                console.warn('[DisputeService] Failed to create adjustment:', err.message);
            }
        }
    }

    // If upheld (no change), restore invoice to pending
    if (resolution === 'upheld' && data.invoiceId) {
        try {
            await updateDoc(doc(db, 'vendorInvoices', data.invoiceId), {
                payoutLifecycle: 'pending_payment',
                paymentStatus: 'PENDING',
                updatedAt: serverTimestamp(),
            });
        } catch (_) {}
    }

    // Audit
    try {
        await addDoc(collection(db, 'adminChangeLogs'), {
            entityType: 'dispute',
            entityId: disputeId,
            action: 'dispute_resolved',
            changedBy: resolvedBy,
            metadata: { resolution, adjustmentAmount },
            timestamp: serverTimestamp(),
        });
    } catch (_) {}
}

/**
 * Get disputes for a vendor.
 */
export async function getVendorDisputes(vendorId) {
    const q = query(collection(db, 'financeDisputes'), where('vendorId', '==', vendorId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
