/**
 * catalogUtils.js
 *
 * Shared utility functions for the master restaurants and catalogItems collections.
 * Used by migration scripts, admin pages, AI engines, and vendor item forms.
 *
 * All functions are pure and have no Firestore dependencies.
 */

// ─── Item Name Normalization ──────────────────────────────────────────────────

/**
 * Known aliases: maps common vendor-specific item names to canonical names.
 * This is the same alias map used in forecastHelpers.js — kept in sync here.
 */
const ITEM_ALIAS_MAP = {
    'white onion': 'Onion - Cooking',
    'red onion': 'Onion - Red',
    'spring onion': 'Green Onion',
    'garlic': 'Peeled Garlic',
    'green plantain': 'Plantain Green',
    'coriander': 'Coriander Leaves',
    'mint': 'Mint Leaves',
    'onion cooking': 'Onion - Cooking',
    'onion cooking 50lbs': 'Onion - Cooking',
    'onion red 25lbs': 'Onion - Red',
    'carrot 50lbs': 'Carrot',
    'yellow onion 50lb': 'Onion - Cooking',
    'yellow onion': 'Onion - Cooking',
    'cooking onion': 'Onion - Cooking',
};

/**
 * Strip common suffixes like weights and packaging from item names.
 * e.g. "Onion Cooking 50lbs" → "Onion Cooking"
 */
function stripCommonSuffixes(name) {
    return name
        .replace(/\s*\d+\s*(lbs?|kg|oz|g|ml|l|lb)\s*$/i, '')
        .replace(/\s*\d+\s*(pack|pcs?|bunch|case|box|bag|ct)\s*$/i, '')
        .trim();
}

/**
 * Generate a normalized key from an item name.
 * Used for matching and as a candidate catalogItemId.
 * 
 * Steps: trim → lowercase → resolve alias → strip suffixes → snake_case
 * 
 * Examples:
 *   "Onion Cooking 50lbs" → "onion_cooking"
 *   "Mint Leaves"         → "mint_leaves"
 *   "Yellow Onion 50lb"   → "onion_cooking" (via alias)
 */
export function normalizeItemKey(name) {
    if (!name) return '';
    const lower = name.trim().toLowerCase();
    
    // Check alias map first
    const aliasKey = Object.keys(ITEM_ALIAS_MAP).find(k => k.toLowerCase() === lower);
    const resolved = aliasKey ? ITEM_ALIAS_MAP[aliasKey] : name.trim();
    
    // Strip suffixes, then convert to snake_case
    const stripped = stripCommonSuffixes(resolved);
    return stripped
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')  // remove special chars except spaces
        .replace(/\s+/g, '_')          // spaces → underscores
        .replace(/_+/g, '_')           // collapse multiple underscores
        .replace(/^_|_$/g, '');        // trim leading/trailing underscores
}

/**
 * Generate a canonical display name from a normalized key.
 * "onion_cooking" → "Onion Cooking"
 */
export function keyToCanonicalName(key) {
    if (!key) return '';
    return key
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// ─── Catalog Item Matching ────────────────────────────────────────────────────

/**
 * Try to match a vendor item name to a catalog item.
 * 
 * Matching priority:
 *   1. Exact canonicalName match (case-insensitive)
 *   2. Alias match (any alias in the aliases array)
 *   3. Normalized key match
 * 
 * @param {string} itemName - The vendor item name to match
 * @param {Array} catalogItems - Array of catalog item objects with { catalogItemId, canonicalName, normalizedKey, aliases }
 * @returns {{ catalogItemId: string, canonicalName: string, matchType: string } | null}
 */
export function matchCatalogItem(itemName, catalogItems) {
    if (!itemName || !catalogItems || catalogItems.length === 0) return null;
    
    const nameLower = itemName.trim().toLowerCase();
    const nameKey = normalizeItemKey(itemName);

    // 1. Exact canonical name match
    const exactMatch = catalogItems.find(c => 
        c.canonicalName && c.canonicalName.toLowerCase() === nameLower
    );
    if (exactMatch) return { catalogItemId: exactMatch.catalogItemId, canonicalName: exactMatch.canonicalName, matchType: 'exact' };

    // 2. Alias match
    const aliasMatch = catalogItems.find(c => 
        (c.aliases || []).some(a => a.toLowerCase() === nameLower)
    );
    if (aliasMatch) return { catalogItemId: aliasMatch.catalogItemId, canonicalName: aliasMatch.canonicalName, matchType: 'alias' };

    // 3. Normalized key match
    const keyMatch = catalogItems.find(c => 
        c.normalizedKey === nameKey
    );
    if (keyMatch) return { catalogItemId: keyMatch.catalogItemId, canonicalName: keyMatch.canonicalName, matchType: 'normalized' };

    return null;
}

// ─── ID Generators ────────────────────────────────────────────────────────────

/**
 * Generate a catalogItemId from a canonical item name.
 * "Onion - Cooking" → "onion_cooking"
 */
export function generateCatalogItemId(canonicalName) {
    return normalizeItemKey(canonicalName);
}

/**
 * Generate a restaurantId from a restaurant name.
 * "Oruma Takeout" → "oruma_takeout"
 */
export function generateRestaurantId(name) {
    if (!name) return '';
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a restaurant document before save.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateRestaurant(doc) {
    const errors = [];
    if (!doc.name?.trim()) errors.push('Restaurant name is required');
    if (!doc.restaurantId?.trim()) errors.push('Restaurant ID is required');
    return { valid: errors.length === 0, errors };
}

/**
 * Validate a catalog item document before save.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateCatalogItem(doc) {
    const errors = [];
    if (!doc.canonicalName?.trim()) errors.push('Canonical name is required');
    if (!doc.catalogItemId?.trim()) errors.push('Catalog item ID is required');
    if (!doc.category?.trim()) errors.push('Category is required');
    return { valid: errors.length === 0, errors };
}
