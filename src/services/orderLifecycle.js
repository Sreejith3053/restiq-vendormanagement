/**
 * orderLifecycle.js
 *
 * Strict order lifecycle state machine for the RestIQ platform.
 * Prevents invalid state transitions across orders, dispatches, and fulfillment.
 *
 * Usage:
 *   import { validateOrderTransition, ORDER_STATES } from '../services/orderLifecycle';
 *   const result = validateOrderTransition('submitted', 'delivered');
 *   if (!result.valid) toast.error(result.error);
 */

// ── Normalized Order States ─────────────────────────────────────────────────

export const ORDER_STATES = {
    DRAFT:              'draft',
    SUBMITTED:          'submitted',
    AGGREGATED:         'aggregated',
    ALLOCATED:          'allocated',
    SENT_TO_VENDOR:     'sent_to_vendor',
    VENDOR_CONFIRMED:   'vendor_confirmed',
    WAREHOUSE_READY:    'warehouse_ready',
    IN_TRANSIT:         'in_transit',
    DELIVERED:          'delivered',
    FULFILLED:          'fulfilled',
    ISSUE_OPEN:         'issue_open',
    CLOSED:             'closed',
};

// ── Valid Transition Map ────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
    [ORDER_STATES.DRAFT]:            [ORDER_STATES.SUBMITTED],
    [ORDER_STATES.SUBMITTED]:        [ORDER_STATES.AGGREGATED, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.AGGREGATED]:       [ORDER_STATES.ALLOCATED, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.ALLOCATED]:        [ORDER_STATES.SENT_TO_VENDOR, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.SENT_TO_VENDOR]:   [ORDER_STATES.VENDOR_CONFIRMED, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.VENDOR_CONFIRMED]: [ORDER_STATES.WAREHOUSE_READY, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.WAREHOUSE_READY]:  [ORDER_STATES.IN_TRANSIT, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.IN_TRANSIT]:       [ORDER_STATES.DELIVERED, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.DELIVERED]:        [ORDER_STATES.FULFILLED, ORDER_STATES.ISSUE_OPEN],
    [ORDER_STATES.FULFILLED]:        [ORDER_STATES.CLOSED],
    [ORDER_STATES.ISSUE_OPEN]:       [ORDER_STATES.CLOSED, ORDER_STATES.SUBMITTED, ORDER_STATES.SENT_TO_VENDOR],
    [ORDER_STATES.CLOSED]:           [], // terminal state
};

// ── Dispatch-Specific States ────────────────────────────────────────────────

export const DISPATCH_STATES = {
    DRAFT:                'Draft',
    SENT:                 'Sent',
    PARTIALLY_CONFIRMED:  'Partially Confirmed',
    CONFIRMED:            'Confirmed',
    REJECTED:             'Rejected',
    WAREHOUSE_READY:      'Warehouse Ready',
    DELIVERED:            'Delivered',
    CLOSED:               'Closed',
};

const DISPATCH_TRANSITIONS = {
    [DISPATCH_STATES.DRAFT]:               [DISPATCH_STATES.SENT],
    [DISPATCH_STATES.SENT]:                [DISPATCH_STATES.CONFIRMED, DISPATCH_STATES.PARTIALLY_CONFIRMED, DISPATCH_STATES.REJECTED],
    [DISPATCH_STATES.PARTIALLY_CONFIRMED]: [DISPATCH_STATES.CONFIRMED, DISPATCH_STATES.REJECTED, DISPATCH_STATES.WAREHOUSE_READY],
    [DISPATCH_STATES.CONFIRMED]:           [DISPATCH_STATES.WAREHOUSE_READY],
    [DISPATCH_STATES.REJECTED]:            [DISPATCH_STATES.SENT, DISPATCH_STATES.CLOSED], // can resend or close
    [DISPATCH_STATES.WAREHOUSE_READY]:     [DISPATCH_STATES.DELIVERED],
    [DISPATCH_STATES.DELIVERED]:           [DISPATCH_STATES.CLOSED],
    [DISPATCH_STATES.CLOSED]:              [],
};

// ── Payment States ──────────────────────────────────────────────────────────

export const PAYMENT_STATES = {
    PENDING:        'pending',
    PAID:           'paid',
    OVERDUE:        'overdue',
    PARTIALLY_PAID: 'partially_paid',
    VOIDED:         'voided',
};

const PAYMENT_TRANSITIONS = {
    [PAYMENT_STATES.PENDING]:        [PAYMENT_STATES.PAID, PAYMENT_STATES.OVERDUE, PAYMENT_STATES.PARTIALLY_PAID, PAYMENT_STATES.VOIDED],
    [PAYMENT_STATES.OVERDUE]:        [PAYMENT_STATES.PAID, PAYMENT_STATES.PARTIALLY_PAID, PAYMENT_STATES.VOIDED],
    [PAYMENT_STATES.PARTIALLY_PAID]: [PAYMENT_STATES.PAID, PAYMENT_STATES.OVERDUE],
    [PAYMENT_STATES.PAID]:           [], // terminal — cannot revert
    [PAYMENT_STATES.VOIDED]:         [], // terminal
};

// ── Validators ──────────────────────────────────────────────────────────────

/**
 * Validate an order state transition.
 *
 * @param {string} currentState - Current order state
 * @param {string} nextState    - Proposed next state
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateOrderTransition(currentState, nextState) {
    const normalized = (currentState || '').toLowerCase().trim();
    const nextNorm = (nextState || '').toLowerCase().trim();

    if (!normalized) {
        return { valid: false, error: `Invalid current state: "${currentState}"` };
    }
    if (!nextNorm) {
        return { valid: false, error: `Invalid target state: "${nextState}"` };
    }

    const allowed = VALID_TRANSITIONS[normalized];
    if (!allowed) {
        // Unknown current state — allow transition but log warning
        console.warn(`[OrderLifecycle] Unknown state "${normalized}", allowing transition to "${nextNorm}"`);
        return { valid: true, warning: `Unknown current state "${normalized}" — transition allowed but unvalidated` };
    }

    if (allowed.includes(nextNorm)) {
        return { valid: true };
    }

    return {
        valid: false,
        error: `Invalid transition: "${currentState}" → "${nextState}". Allowed: [${allowed.join(', ')}]`,
    };
}

/**
 * Validate a dispatch status transition.
 *
 * @param {string} currentStatus - Current dispatch status
 * @param {string} nextStatus    - Proposed next status
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDispatchTransition(currentStatus, nextStatus) {
    const current = (currentStatus || '').trim();
    const next = (nextStatus || '').trim();

    const allowed = DISPATCH_TRANSITIONS[current];
    if (!allowed) {
        console.warn(`[DispatchLifecycle] Unknown status "${current}", allowing transition`);
        return { valid: true, warning: `Unknown status "${current}"` };
    }

    if (allowed.includes(next)) {
        return { valid: true };
    }

    return {
        valid: false,
        error: `Invalid dispatch transition: "${current}" → "${next}". Allowed: [${allowed.join(', ')}]`,
    };
}

/**
 * Validate a payment status transition.
 *
 * @param {string} currentStatus - Current payment status
 * @param {string} nextStatus    - Proposed next status
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePaymentTransition(currentStatus, nextStatus) {
    const current = (currentStatus || 'pending').toLowerCase().trim();
    const next = (nextStatus || '').toLowerCase().trim();

    const allowed = PAYMENT_TRANSITIONS[current];
    if (!allowed) {
        return { valid: false, error: `Unknown payment status: "${currentStatus}"` };
    }

    if (allowed.length === 0) {
        return { valid: false, error: `Payment status "${current}" is terminal and cannot be changed.` };
    }

    if (allowed.includes(next)) {
        return { valid: true };
    }

    return {
        valid: false,
        error: `Invalid payment transition: "${current}" → "${next}". Allowed: [${allowed.join(', ')}]`,
    };
}

// ── Display Helpers ─────────────────────────────────────────────────────────

const STATUS_DISPLAY = {
    draft:              { label: 'Draft',             color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
    submitted:          { label: 'Submitted',         color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
    aggregated:         { label: 'Aggregated',        color: '#818cf8', bg: 'rgba(129,140,248,0.12)' },
    allocated:          { label: 'Allocated',         color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
    sent_to_vendor:     { label: 'Sent to Vendor',    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
    vendor_confirmed:   { label: 'Vendor Confirmed',  color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    warehouse_ready:    { label: 'Warehouse Ready',   color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
    in_transit:         { label: 'In Transit',        color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
    delivered:          { label: 'Delivered',         color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    fulfilled:          { label: 'Fulfilled',         color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    issue_open:         { label: 'Issue Open',        color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
    closed:             { label: 'Closed',            color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
    // Dispatch-specific
    'Draft':                { label: 'Draft',              color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
    'Sent':                 { label: 'Sent',               color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
    'Partially Confirmed':  { label: 'Partial',            color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
    'Confirmed':            { label: 'Confirmed',          color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    'Rejected':             { label: 'Rejected',           color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
    'Warehouse Ready':      { label: 'Warehouse',          color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
    'Delivered':            { label: 'Delivered',           color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    'Closed':               { label: 'Closed',             color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
    // Payment
    pending:            { label: 'Pending',           color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
    paid:               { label: 'Paid',              color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    overdue:            { label: 'Overdue',           color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
    partially_paid:     { label: 'Partial Payment',   color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
    voided:             { label: 'Voided',            color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};

/**
 * Get display properties for a status value.
 * @param {string} status
 * @returns {{ label: string, color: string, bg: string }}
 */
export function getStatusDisplay(status) {
    const key = (status || '').trim();
    return STATUS_DISPLAY[key] || STATUS_DISPLAY[key.toLowerCase()] || {
        label: status || 'Unknown',
        color: '#94a3b8',
        bg: 'rgba(148,163,184,0.12)',
    };
}

/**
 * Get just the color for a status.
 * @param {string} status
 * @returns {string}
 */
export function getStatusColor(status) {
    return getStatusDisplay(status).color;
}

/**
 * Get just the label for a status.
 * @param {string} status
 * @returns {string}
 */
export function getStatusLabel(status) {
    return getStatusDisplay(status).label;
}

/**
 * Check if a state is a terminal (final) state.
 * @param {string} state
 * @returns {boolean}
 */
export function isTerminalState(state) {
    const norm = (state || '').toLowerCase().trim();
    return norm === ORDER_STATES.CLOSED || norm === ORDER_STATES.FULFILLED;
}

/**
 * Check if a state indicates an active issue.
 * @param {string} state
 * @returns {boolean}
 */
export function isIssueState(state) {
    return (state || '').toLowerCase().trim() === ORDER_STATES.ISSUE_OPEN;
}

/**
 * Get valid next states for a given current state.
 * @param {string} currentState
 * @param {'order'|'dispatch'|'payment'} type
 * @returns {string[]}
 */
export function getValidNextStates(currentState, type = 'order') {
    const map = type === 'dispatch' ? DISPATCH_TRANSITIONS
        : type === 'payment' ? PAYMENT_TRANSITIONS
        : VALID_TRANSITIONS;
    const key = type === 'dispatch' ? (currentState || '').trim() : (currentState || '').toLowerCase().trim();
    return map[key] || [];
}
