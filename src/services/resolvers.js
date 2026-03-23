/**
 * resolvers.js
 *
 * ════════════════════════════════════════════════════════════════
 * SHARED RESOLVER HELPERS — used across Control Tower, Orders,
 * invoices, and any table that displays restaurant/vendor names.
 * ════════════════════════════════════════════════════════════════
 *
 * All functions are synchronous lookups against a pre-loaded map,
 * making them cheap to call in render loops. Build the map once
 * with buildRestaurantMap() / buildVendorMap() at component mount.
 */

// ─── Restaurant name resolution ────────────────────────────────────────────────

/**
 * resolveRestaurantName(restaurantId, restaurantsMap, order?)
 *
 * Resolution priority:
 * 1. restaurantId → restaurants collection lookup (from preloaded map)
 * 2. order.restaurantName snapshot
 * 3. raw restaurantId string (if it reads like a slug)
 * 4. 'Unknown Restaurant'
 *
 * @param {string}  restaurantId
 * @param {object}  restaurantsMap   { [id]: { name, restaurantName, ... } }
 * @param {object=} order            optional order doc with restaurantName snapshot
 * @returns {string}
 */
export function resolveRestaurantName(restaurantId, restaurantsMap = {}, order = {}) {
    if (!restaurantId && !order?.restaurantName) return 'Unknown Restaurant';

    // 1. Lookup in restaurants collection map
    if (restaurantId && restaurantsMap[restaurantId]) {
        const rDoc = restaurantsMap[restaurantId];
        return rDoc.name || rDoc.restaurantName || restaurantId;
    }

    // 2. Order snapshot
    if (order?.restaurantName && order.restaurantName !== 'Unknown Restaurant') {
        return order.restaurantName;
    }

    // 3. Raw ID if present
    if (restaurantId && restaurantId !== 'Unknown Restaurant') {
        return restaurantId;
    }

    return 'Unknown Restaurant';
}

// ─── Vendor name resolution ────────────────────────────────────────────────────

/**
 * resolveVendorName(vendorId, vendorsMap, fallbacks?)
 *
 * Resolution priority:
 * 1. vendorId → vendors collection lookup (from preloaded map)
 * 2. fallbacks.vendorName (from order/invoice snapshot)
 * 3. raw vendorId
 * 4. 'Unknown Vendor'
 *
 * @param {string}  vendorId
 * @param {object}  vendorsMap    { [id]: { name, businessName, ... } }
 * @param {object=} fallbacks     { vendorName? }
 * @returns {string}
 */
export function resolveVendorName(vendorId, vendorsMap = {}, fallbacks = {}) {
    // 1. Vendors collection map
    if (vendorId && vendorsMap[vendorId]) {
        const vDoc = vendorsMap[vendorId];
        return vDoc.name || vDoc.businessName || vendorId;
    }

    // 2. Snapshot field
    if (fallbacks?.vendorName && fallbacks.vendorName !== 'Unknown Vendor') {
        return fallbacks.vendorName;
    }

    // 3. Raw ID
    if (vendorId && vendorId !== 'Unknown Vendor') {
        return vendorId;
    }

    return 'Unknown Vendor';
}

// ─── Restaurant status normalization ──────────────────────────────────────────

/**
 * normalizeRestaurantStatus(data)
 *
 * Normalize a restaurant document's status into one of:
 *   'active' | 'onhold' | 'inactive'
 *
 * Rules:
 *   - status === 'active' (any case)        → 'active'
 *   - active === true                        → 'active'
 *   - status === 'hold' / 'on hold' / etc   → 'onhold'
 *   - status === 'inactive' / active=false   → 'inactive'
 *   - missing status field                  → 'active' (default, most restaurants are active)
 *
 * @param {object} data  Firestore document data
 * @returns {'active'|'onhold'|'inactive'}
 */
export function normalizeRestaurantStatus(data) {
    const s = (data.status || '').toLowerCase().replace(/[_\s-]/g, '');

    if (s === 'active' || data.active === true) return 'active';
    if (s === 'onhold' || s === 'hold' || s === 'paused' || s === 'suspended') return 'onhold';
    if (s === 'inactive' || s === 'disabled' || s === 'archived' || data.active === false) return 'inactive';

    // Default: if no status field set, treat as active (newly created restaurants)
    if (!data.status && data.active !== false) return 'active';

    // Any other value — treat as active
    return 'active';
}

// ─── Map builders (call once in useEffect, pass map to resolvers) ─────────────

/**
 * toRestaurantsMap(restaurantsDocs)
 * @param {{ id: string, [key: string]: any }[]} docs  array of restaurant docs
 * @returns { [id: string]: object }
 */
export function toRestaurantsMap(docs) {
    return Object.fromEntries(docs.map(d => [d.id, d]));
}

/**
 * toVendorsMap(vendorsDocs)
 */
export function toVendorsMap(docs) {
    return Object.fromEntries(docs.map(d => [d.id, d]));
}
