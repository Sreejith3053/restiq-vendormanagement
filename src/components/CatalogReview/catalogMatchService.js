/**
 * catalogMatchService.js
 *
 * Suggests catalog + vendor item matches for the review queue.
 * Also builds risk flag arrays from row data.
 */

import { db } from '../../firebase';
import {
    collection, getDocs, query, where, limit, orderBy,
} from 'firebase/firestore';
import { normalizeText, stringSimilarity } from '../BulkImport/importMatching';

// ── Risk Flag Builder ──────────────────────────────────────────────────────────

/**
 * buildRiskFlags(row)
 * Returns array of human-readable risk flag strings for a matched import row.
 */
export function buildRiskFlags(row, existingItem = null) {
    const flags = [];

    // Price delta check
    const oldPrice = existingItem
        ? parseFloat(existingItem.vendorPrice ?? existingItem.price ?? 0)
        : null;
    const newPrice = parseFloat(row.price || 0);

    if (oldPrice !== null && oldPrice > 0 && newPrice > 0) {
        const pct = ((newPrice - oldPrice) / oldPrice) * 100;
        if (pct > 100)       flags.push(`🚨 Price increased ${pct.toFixed(0)}% ($${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)})`);
        else if (pct > 50)   flags.push(`⚠️ Large price increase +${pct.toFixed(0)}%`);
        else if (pct < -30)  flags.push(`⚠️ Large price decrease ${pct.toFixed(0)}%`);
    }

    // Unit type changes
    if (existingItem) {
        const old = (existingItem.baseUnit || existingItem.unit || '').toLowerCase(); // v2-first
        const nw  = (row.unit || '').toLowerCase();
        const eachTypes = ['each', 'ea', 'pcs', 'piece', 'unit', 'packet'];
        const caseTypes = ['case', 'box', 'bag', 'tray', 'container'];
        const bulkTypes = ['lb', 'kg', 'g', 'oz', 'l', 'ml'];

        const catOld = eachTypes.includes(old) ? 'each' : caseTypes.includes(old) ? 'case' : bulkTypes.includes(old) ? 'bulk' : 'other';
        const catNew = eachTypes.includes(nw)  ? 'each' : caseTypes.includes(nw)  ? 'case' : bulkTypes.includes(nw)  ? 'bulk' : 'other';

        if (catOld !== catNew && catOld !== 'other' && catNew !== 'other') {
            flags.push(`🔄 Unit type changed: ${old} → ${nw} (possible per-piece vs per-case mismatch)`);
        }
    }

    // Naming variant match
    if (row.matchType === 'naming_variant') {
        flags.push(`📝 Matched via naming variant — verify this is the same product`);
    }

    // Multiple candidates / ambiguous
    if (row.matchType === 'name_match_multiple') {
        flags.push(`🔀 Multiple existing items with same name — ambiguous match`);
    }

    // Possible duplicate
    if (row.actionResult === 'new_possible_duplicate' || row.matchType === 'new_possible_duplicate') {
        flags.push(`⚠️ Similar items already exist — possible duplicate`);
    }

    // Pack size changed
    if (existingItem && row.packSize && existingItem.packSize) {
        if ((row.packSize || '').trim() !== (existingItem.packSize || '').trim()) {
            flags.push(`📦 Pack size changed: "${existingItem.packSize}" → "${row.packSize}"`);
        }
    }

    return flags;
}

// ── Catalog Match Suggestions ──────────────────────────────────────────────────

/**
 * getSuggestedCatalogMatches(itemName, category)
 * Returns top catalogItems that match the item name.
 */
export async function getSuggestedCatalogMatches(itemName, category = '') {
    if (!itemName) return [];

    // Load a broad set and score client-side (Firestore doesn't support full-text search natively)
    let q = query(collection(db, 'catalogItems'), where('status', '==', 'active'), limit(100));
    const snap = await getDocs(q);

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const norm  = normalizeText(itemName);

    return items
        .map(item => {
            const nameSim  = stringSimilarity(norm, normalizeText(item.canonicalName || item.itemName || ''));
            const aliasSim = Math.max(0, ...(item.aliases || []).map(a => stringSimilarity(norm, normalizeText(a))));
            const sim      = Math.max(nameSim, aliasSim);
            return { ...item, similarity: Math.round(sim * 100) };
        })
        .filter(item => item.similarity >= 40)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
}

/**
 * getSuggestedVendorMatches(vendorId, itemName)
 * Returns similar vendor items already in the vendor's catalog.
 */
export async function getSuggestedVendorMatches(vendorId, itemName) {
    if (!vendorId || !itemName) return [];

    const snap = await getDocs(query(collection(db, 'vendors', vendorId, 'items'), limit(200)));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const norm  = normalizeText(itemName);

    return items
        .map(item => {
            // v2: prefer pre-computed normalized field; fall back to runtime normalization
            const itemNorm = item.itemNameNormalized || normalizeText(item.itemName || item.name || '');
            const sim = stringSimilarity(norm, itemNorm);
            return { ...item, similarity: Math.round(sim * 100) };
        })
        .filter(item => item.similarity >= 50)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
}
