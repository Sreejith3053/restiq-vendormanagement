/**
 * accessControl.js
 *
 * Role-Based Access Control (RBAC) for the RestIQ platform.
 * Enforces strict separation between admin, vendor, and restaurant roles.
 *
 * Usage:
 *   import { canPerformAction, ACTIONS } from '../services/accessControl';
 *   if (!canPerformAction(userRole, ACTIONS.MARK_INVOICE_PAID)) { toast.error('Unauthorized'); return; }
 */

// ── Roles ───────────────────────────────────────────────────────────────────

export const ROLES = {
    SUPERADMIN:  'superadmin',
    ADMIN:       'admin',
    VENDOR:      'vendor',
    RESTAURANT:  'restaurant',
};

// ── Actions ─────────────────────────────────────────────────────────────────

export const ACTIONS = {
    // Catalog
    APPROVE_CATALOG:     'approve_catalog',
    EDIT_CATALOG:        'edit_catalog',
    MERGE_CATALOG:       'merge_catalog',
    IMPORT_CATALOG:      'import_catalog',

    // Invoices
    CREATE_INVOICE:      'create_invoice',
    MARK_INVOICE_PAID:   'mark_invoice_paid',
    VOID_INVOICE:        'void_invoice',

    // Orders
    SUBMIT_ORDER:        'submit_order',
    CANCEL_ORDER:        'cancel_order',
    UPDATE_ORDER_STATUS: 'update_order_status',

    // Dispatch
    SEND_DISPATCH:       'send_dispatch',
    CONFIRM_DISPATCH:    'confirm_dispatch',

    // Intelligence
    VIEW_PRICING:        'view_pricing',
    VIEW_INTELLIGENCE:   'view_intelligence',
    VIEW_VENDOR_RANKING: 'view_vendor_ranking',

    // Platform
    RUN_MIGRATION:       'run_migration',
    MANAGE_USERS:        'manage_users',
    VIEW_AUDIT_LOGS:     'view_audit_logs',
    MANAGE_SETTINGS:     'manage_settings',

    // Issues
    CREATE_ISSUE:        'create_issue',
    RESOLVE_ISSUE:       'resolve_issue',
};

// ── Permission Matrix ───────────────────────────────────────────────────────

const PERMISSION_MATRIX = {
    [ROLES.SUPERADMIN]: new Set(Object.values(ACTIONS)), // Full access

    [ROLES.ADMIN]: new Set([
        ACTIONS.APPROVE_CATALOG,
        ACTIONS.EDIT_CATALOG,
        ACTIONS.MERGE_CATALOG,
        ACTIONS.IMPORT_CATALOG,
        ACTIONS.CREATE_INVOICE,
        ACTIONS.MARK_INVOICE_PAID,
        ACTIONS.VOID_INVOICE,
        ACTIONS.UPDATE_ORDER_STATUS,
        ACTIONS.SEND_DISPATCH,
        ACTIONS.VIEW_PRICING,
        ACTIONS.VIEW_INTELLIGENCE,
        ACTIONS.VIEW_VENDOR_RANKING,
        ACTIONS.VIEW_AUDIT_LOGS,
        ACTIONS.CREATE_ISSUE,
        ACTIONS.RESOLVE_ISSUE,
    ]),

    [ROLES.VENDOR]: new Set([
        ACTIONS.CONFIRM_DISPATCH,  // Can confirm their dispatches
        ACTIONS.CREATE_ISSUE,      // Can report issues
        // Cannot see other vendors' pricing or rankings
    ]),

    [ROLES.RESTAURANT]: new Set([
        ACTIONS.SUBMIT_ORDER,
        ACTIONS.CANCEL_ORDER,
        ACTIONS.CREATE_ISSUE,
        // Cannot see intelligence, scoring, or internal pricing
    ]),
};

// ── Access Check ────────────────────────────────────────────────────────────

/**
 * Check if a role can perform a specific action.
 *
 * @param {string} role - User role
 * @param {string} action - Action to check (from ACTIONS enum)
 * @returns {boolean}
 */
export function canPerformAction(role, action) {
    const normalizedRole = (role || '').toLowerCase().trim();

    // SuperAdmin always has access
    if (normalizedRole === ROLES.SUPERADMIN || normalizedRole === 'super_admin') {
        return true;
    }

    const permissions = PERMISSION_MATRIX[normalizedRole];
    if (!permissions) {
        console.warn(`[AccessControl] Unknown role: "${role}"`);
        return false;
    }

    return permissions.has(action);
}

/**
 * Get all allowed actions for a given role.
 *
 * @param {string} role
 * @returns {string[]}
 */
export function getAllowedActions(role) {
    const normalizedRole = (role || '').toLowerCase().trim();
    if (normalizedRole === ROLES.SUPERADMIN || normalizedRole === 'super_admin') {
        return Object.values(ACTIONS);
    }
    const permissions = PERMISSION_MATRIX[normalizedRole];
    return permissions ? Array.from(permissions) : [];
}

/**
 * Guard a function — only executes if the user has permission.
 *
 * @param {string} role - User role
 * @param {string} action - Required action
 * @param {Function} fn - Function to execute if authorized
 * @param {Function} [onDenied] - Callback if denied
 * @returns {Promise<any>}
 */
export async function guardAction(role, action, fn, onDenied) {
    if (!canPerformAction(role, action)) {
        const msg = `Access denied: role "${role}" cannot perform "${action}"`;
        console.warn(`[AccessControl] ${msg}`);
        if (onDenied) onDenied(msg);
        return { denied: true, message: msg };
    }
    return fn();
}

/**
 * Check if a vendor user is trying to access another vendor's data.
 *
 * @param {string} userRole
 * @param {string} userVendorId - The vendor ID associated with the logged-in user
 * @param {string} targetVendorId - The vendor ID being accessed
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkVendorIsolation(userRole, userVendorId, targetVendorId) {
    const role = (userRole || '').toLowerCase().trim();

    // Admins can see everything
    if (role === ROLES.SUPERADMIN || role === ROLES.ADMIN || role === 'super_admin') {
        return { allowed: true };
    }

    // Vendors can only see their own data
    if (role === ROLES.VENDOR) {
        if (!userVendorId || !targetVendorId) {
            return { allowed: false, reason: 'Vendor identity not verified' };
        }
        if (userVendorId !== targetVendorId) {
            return { allowed: false, reason: 'Cannot access other vendor data' };
        }
        return { allowed: true };
    }

    return { allowed: true };
}
