/**
 * migrateCatalogItems.js
 *
 * Enhanced migration: Scans vendor items, deduplicates by normalized key,
 * creates catalogItems, links vendor items, routes ambiguous matches to
 * catalogItemMappingReview, and logs to migrationLogs.
 *
 * SAFE: Only creates + enriches. Never overwrites or deletes. Idempotent.
 */
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { normalizeItemKey, generateCatalogItemId } from './catalogUtils';

const BATCH_SIZE = 20;

// Short or generic names that are too ambiguous to auto-match
const AMBIGUOUS_NAMES = new Set([
    'fish', 'chicken', 'chilli', 'leaves', 'mixed', 'mixed veg', 'curry',
    'sauce', 'oil', 'salt', 'sugar', 'flour', 'powder', 'paste', 'water',
    'butter', 'cream', 'cheese', 'egg', 'eggs', 'rice', 'bread',
]);

/**
 * Check if an item name is too ambiguous to auto-map.
 */
function isAmbiguous(name) {
    if (!name) return true;
    const lower = name.trim().toLowerCase();
    // Too short
    if (lower.length < 3) return true;
    // Generic single-word names
    if (AMBIGUOUS_NAMES.has(lower)) return true;
    // Single word items under 6 chars are risky
    if (!lower.includes(' ') && !lower.includes('-') && lower.length < 6) return true;
    return false;
}

/**
 * Run the catalog items migration.
 * @param {Function} onProgress - callback(msg) for live progress updates
 * @returns {{ catalogCreated, vendorItemsLinked, skipped, needsReview, errors, items }}
 */
export async function migrateCatalogItems(onProgress) {
    const log = { catalogCreated: 0, vendorItemsLinked: 0, skipped: 0, needsReview: 0, errors: [], items: [] };
    const startTime = new Date();

    try {
        // 1. Scan all vendor items
        if (onProgress) onProgress('Scanning vendor items...');
        const vendorsSnap = await getDocs(collection(db, 'vendors'));
        const allVendorItems = [];

        for (const vendorDoc of vendorsSnap.docs) {
            const vendor = vendorDoc.data();
            const vendorId = vendorDoc.id;
            const vendorName = vendor.name || vendor.companyName || vendorId;

            const itemsSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
            itemsSnap.docs.forEach(itemDoc => {
                const item = itemDoc.data();
                const itemName = item.name || item.itemName || '';
                if (!itemName) return;

                allVendorItems.push({
                    vendorId,
                    vendorName,
                    itemDocId: itemDoc.id,
                    itemName,
                    category: item.category || '',
                    unit: item.unit || '',
                    packSize: item.packQuantity || item.packSize || '',
                    normalizedKey: normalizeItemKey(itemName),
                    existingCatalogItemId: item.catalogItemId || null,
                });
            });
        }

        if (onProgress) onProgress(`Found ${allVendorItems.length} vendor items across ${vendorsSnap.docs.length} vendors`);

        // 2. Route ambiguous items to review queue
        const clearItems = [];
        const ambiguousItems = [];

        allVendorItems.forEach(vi => {
            if (!vi.normalizedKey || isAmbiguous(vi.itemName)) {
                ambiguousItems.push(vi);
            } else {
                clearItems.push(vi);
            }
        });

        if (onProgress) onProgress(`Clear matches: ${clearItems.length}, Needs review: ${ambiguousItems.length}`);

        // 3. Group clear items by normalizedKey
        const byKey = {};
        clearItems.forEach(vi => {
            if (!byKey[vi.normalizedKey]) byKey[vi.normalizedKey] = [];
            byKey[vi.normalizedKey].push(vi);
        });

        const uniqueKeys = Object.keys(byKey);
        if (onProgress) onProgress(`Detected ${uniqueKeys.length} unique normalized items`);

        // 4. Create catalog items and link vendor items in batches
        const keyBatches = [];
        for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
            keyBatches.push(uniqueKeys.slice(i, i + BATCH_SIZE));
        }

        for (let batchIdx = 0; batchIdx < keyBatches.length; batchIdx++) {
            const batch = keyBatches[batchIdx];
            if (onProgress) onProgress(`Processing batch ${batchIdx + 1}/${keyBatches.length}...`);

            for (const key of batch) {
                const group = byKey[key];
                const catalogItemId = generateCatalogItemId(key) || key;

                // Determine canonical name — most common spelling
                const nameFreq = {};
                group.forEach(vi => { nameFreq[vi.itemName] = (nameFreq[vi.itemName] || 0) + 1; });
                const canonicalName = Object.entries(nameFreq).sort((a, b) => b[1] - a[1])[0][0];

                // Collect aliases
                const aliases = [...new Set(group.map(vi => vi.itemName))].filter(n => n !== canonicalName);

                // Most common category
                const catFreq = {};
                group.forEach(vi => { if (vi.category) catFreq[vi.category] = (catFreq[vi.category] || 0) + 1; });
                const category = Object.entries(catFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Other';

                // Most common unit
                const unitFreq = {};
                group.forEach(vi => { if (vi.unit) unitFreq[vi.unit] = (unitFreq[vi.unit] || 0) + 1; });
                const baseUnit = Object.entries(unitFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

                // Most common pack size
                const packFreq = {};
                group.forEach(vi => { if (vi.packSize) packFreq[vi.packSize] = (packFreq[vi.packSize] || 0) + 1; });
                const packReference = Object.entries(packFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

                try {
                    // Idempotent: check if catalog item already exists
                    const existing = await getDoc(doc(db, 'catalogItems', catalogItemId));
                    if (existing.exists()) {
                        log.skipped++;
                    } else {
                        // Create catalog item
                        await setDoc(doc(db, 'catalogItems', catalogItemId), {
                            catalogItemId,
                            canonicalName,
                            normalizedKey: key,
                            category,
                            baseUnit,
                            packReference: String(packReference),
                            aliases,
                            status: 'active',
                            vendorCount: new Set(group.map(vi => vi.vendorId)).size,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        });
                        log.catalogCreated++;
                        if (onProgress) onProgress(`✓ Catalog: ${canonicalName} (${aliases.length} aliases, ${group.length} vendor items)`);
                    }

                    // Link vendor items (idempotent: skip if already linked to this ID)
                    for (const vi of group) {
                        if (vi.existingCatalogItemId === catalogItemId) continue;
                        try {
                            await updateDoc(doc(db, `vendors/${vi.vendorId}/items`, vi.itemDocId), {
                                catalogItemId,
                                updatedAt: new Date().toISOString(),
                            });
                            log.vendorItemsLinked++;
                        } catch (linkErr) {
                            log.errors.push(`Link ${vi.vendorName}/${vi.itemName}: ${linkErr.message}`);
                        }
                    }

                    log.items.push({ catalogItemId, canonicalName, aliases, category, vendorCount: group.length, status: 'created' });
                } catch (err) {
                    log.errors.push(`Catalog ${canonicalName}: ${err.message}`);
                }
            }
        }

        // 5. Write ambiguous items to catalogItemMappingReview
        if (ambiguousItems.length > 0) {
            if (onProgress) onProgress(`Writing ${ambiguousItems.length} ambiguous items to review queue...`);
            for (const vi of ambiguousItems) {
                // Skip if already has a catalogItemId (already mapped)
                if (vi.existingCatalogItemId) continue;
                try {
                    // Check idempotency: don't create duplicate review entries
                    // Use a deterministic ID: vendorId_itemDocId
                    const reviewId = `${vi.vendorId}_${vi.itemDocId}`;
                    const existingReview = await getDoc(doc(db, 'catalogItemMappingReview', reviewId));
                    if (existingReview.exists()) continue;

                    await setDoc(doc(db, 'catalogItemMappingReview', reviewId), {
                        vendorId: vi.vendorId,
                        vendorName: vi.vendorName,
                        itemId: vi.itemDocId,
                        itemName: vi.itemName,
                        suggestedNormalizedKey: vi.normalizedKey || '',
                        category: vi.category || '',
                        status: 'pending',
                        createdAt: serverTimestamp(),
                    });
                    log.needsReview++;
                } catch (err) {
                    log.errors.push(`Review ${vi.itemName}: ${err.message}`);
                }
            }
        }

        // 6. Write migration log
        try {
            await addDoc(collection(db, 'migrationLogs'), {
                type: 'catalogItemsBackfill',
                startedAt: startTime.toISOString(),
                completedAt: new Date().toISOString(),
                status: log.errors.length === 0 ? 'completed' : 'completed_with_errors',
                totalProcessed: allVendorItems.length,
                totalCreated: log.catalogCreated,
                totalUpdated: log.vendorItemsLinked,
                totalSkipped: log.skipped,
                totalNeedsReview: log.needsReview,
                errorCount: log.errors.length,
                notes: `Scanned ${vendorsSnap.docs.length} vendors, ${allVendorItems.length} items. ${uniqueKeys.length} unique normalized keys.`,
                createdAt: serverTimestamp(),
            });
        } catch (logErr) {
            console.warn('Migration log write failed:', logErr);
        }

        if (onProgress) onProgress(`✅ Done. Catalog: ${log.catalogCreated}, Linked: ${log.vendorItemsLinked}, Review: ${log.needsReview}, Errors: ${log.errors.length}`);
    } catch (err) {
        log.errors.push(`Fatal: ${err.message}`);
        if (onProgress) onProgress(`❌ Fatal error: ${err.message}`);
    }

    return log;
}
