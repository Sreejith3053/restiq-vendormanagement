/**
 * accessGuard.js
 * 
 * Enterprise access control for RestIQ platform.
 * 
 * Enforces:
 * - Vendor isolation (vendors cannot see competitor data)
 * - Restaurant isolation (restaurants cannot see vendor internals)
 * - Admin-only gates (catalog approval, payment marking, migrations)
 * - Role-level permissions
 */

/* ── Role Definitions ── */
const ROLES = {
    SUPER_ADMIN: 'superadmin',
    ADMIN: 'admin',
    VENDOR_ADMIN: 'vendor_admin',
    VENDOR_USER: 'vendor_user',
    RESTAURANT: 'restaurant',
};

/* ── Permission Matrix ── */
const PERMISSIONS = {
    // Catalog
    'catalog.approve':       [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'catalog.merge':         [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'catalog.delete':        [ROLES.SUPER_ADMIN],
    'catalog.import':        [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.VENDOR_ADMIN],
    'catalog.edit':          [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],
    'catalog.view':          [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],

    // Finance
    'payment.mark_paid':     [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'payment.create_invoice':[ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'payment.view_all':      [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'payment.view_own':      [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],
    'payment.dispute':       [ROLES.VENDOR_ADMIN],

    // Dispatch
    'dispatch.create':       [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'dispatch.confirm':      [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],
    'dispatch.cancel':       [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.VENDOR_ADMIN],
    'dispatch.view_all':     [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'dispatch.view_own':     [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],

    // Vendors
    'vendor.view_all':       [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'vendor.view_own':       [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],
    'vendor.edit_profile':   [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.VENDOR_ADMIN],
    'vendor.manage_users':   [ROLES.VENDOR_ADMIN],

    // Intelligence / Competitor Data
    'intelligence.view':     [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'competitor.view':       [ROLES.SUPER_ADMIN, ROLES.ADMIN], // NEVER vendor

    // System
    'system.migration':      [ROLES.SUPER_ADMIN],
    'system.audit_logs':     [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'system.reconciliation': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'system.observability':  [ROLES.SUPER_ADMIN],

    // Capacity
    'capacity.edit':         [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],
    'capacity.view_all':     [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'capacity.view_own':     [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],

    // Issues
    'issues.view_all':       [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    'issues.view_own':       [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],
    'issues.respond':        [ROLES.VENDOR_ADMIN, ROLES.VENDOR_USER],
    'issues.resolve':        [ROLES.SUPER_ADMIN, ROLES.ADMIN],
};

/**
 * Check if a user has a specific permission.
 *
 * @param {Object} user - { role, isSuperAdmin, vendorId }
 * @param {string} permission - permission key from PERMISSIONS
 * @returns {boolean}
 */
export function hasPermission(user, permission) {
    if (!user || !permission) return false;

    // Super admin has all permissions
    if (user.isSuperAdmin || user.role === ROLES.SUPER_ADMIN) return true;

    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles) return false;

    const userRole = (user.role || '').toLowerCase();
    return allowedRoles.includes(userRole);
}

/**
 * Check if a user can access data for a specific vendor.
 * Vendors can ONLY see their own data.
 *
 * @param {Object} user - { vendorId, isSuperAdmin, role }
 * @param {string} targetVendorId - vendor being accessed
 * @returns {boolean}
 */
export function canAccessVendorData(user, targetVendorId) {
    if (!user) return false;
    if (user.isSuperAdmin || user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN) return true;
    return user.vendorId === targetVendorId;
}

/**
 * Filter a list of items, only returning those owned by the user's vendor.
 *
 * @param {Array} items - items with vendorId field
 * @param {Object} user
 * @returns {Array}
 */
export function filterByVendorAccess(items, user) {
    if (!user || !items) return [];
    if (user.isSuperAdmin || user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN) return items;
    return items.filter(item => item.vendorId === user.vendorId);
}

/**
 * Guard a route or action — throws if unauthorized.
 */
export function requirePermission(user, permission) {
    if (!hasPermission(user, permission)) {
        throw new Error(`Unauthorized: '${permission}' requires ${(PERMISSIONS[permission] || []).join(', ')}`);
    }
}

/**
 * Get all permissions for a role.
 */
export function getPermissionsForRole(role) {
    const perms = [];
    for (const [perm, roles] of Object.entries(PERMISSIONS)) {
        if (roles.includes(role)) perms.push(perm);
    }
    return perms;
}

export { ROLES, PERMISSIONS };
