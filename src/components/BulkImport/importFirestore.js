/**
 * importFirestore.js
 *
 * Firestore service functions for the Vendor Bulk Import module.
 * - createVendorItem — write a new item to vendors/{vendorId}/items/
 * - updateVendorItem — update an existing item + write history
 * - writeItemHistory — subcollection history entry
 * - createImportBatch — create the batch record
 * - writeBatchRowResults — per-row results subcollection
 */
import { db } from '../../firebase';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    setDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { normalizeString } from './importHelpers';
import { normalizeUnit, normalizePackSize } from './importMatching';
import { createCatalogReviewQueueEntry, writeVendorItemHistory } from '../CatalogReview/reviewQueueService';
import { buildRiskFlags } from '../CatalogReview/catalogMatchService';

// ── Normalize a row for Firestore write ───────────────────────────────────────

function buildItemPayload(normalizedRow, extra = {}) {
    return {
        itemName: normalizedRow.itemName,        // standardized field name
        itemNameNormalized: normalizeString(normalizedRow.itemName),
        vendorSKU: normalizedRow.vendorSKU || '',
        category: normalizedRow.category || '',
        brand: normalizedRow.brand || '',
        packSize: normalizedRow.packSize || '',
        packSizeNormalized: normalizePackSize(normalizedRow.packSize || ''),
        unit: normalizedRow.unit || '',
        unitNormalized: normalizeUnit(normalizedRow.unit || ''),
        vendorPrice: parseFloat(normalizedRow.price) || 0,
        currency: normalizedRow.currency || 'CAD',
        minOrderQty: normalizedRow.minOrderQty || '',
        leadTimeDays: normalizedRow.leadTimeDays || '',
        status: normalizedRow.status || 'Active',
        notes: normalizedRow.notes || '',
        ...extra,
    };
}

// ── Create new vendor item ─────────────────────────────────────────────────────

/**
 * createVendorItem(vendorId, normalizedRow, batchId, userId, displayName)
 * Writes a new item document to vendors/{vendorId}/items/.
 * Returns the new Firestore document ID.
 */
export async function createVendorItem(vendorId, normalizedRow, batchId, userId, displayName, extraFields = {}) {
    const payload = buildItemPayload(normalizedRow, {
        vendorId,
        sourceLastUpdated: 'import',
        lastImportBatchId: batchId,
        mappingStatus: 'unmapped',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId || '',
        updatedBy: displayName || userId || 'Import',
        ...extraFields,
    });

    const ref = await addDoc(collection(db, 'vendors', vendorId, 'items'), payload);

    // Write creation history entry
    await writeVendorItemHistory(vendorId, ref.id, {
        changedBy:    displayName || userId || 'Import',
        changeSource: 'import',
        importBatchId: batchId,
        newValues:    payload,
        changedFields: ['created'],
        notes:        'Item created via bulk import',
    });

    return ref.id;
}

// ── Update existing vendor item ────────────────────────────────────────────────

/**
 * updateVendorItem(vendorId, itemId, normalizedRow, oldValues, changedFields, batchId, userId, displayName)
 * Updates the item doc and writes a history subcollection entry.
 */
export async function updateVendorItem(vendorId, itemId, normalizedRow, oldValues, changedFields, batchId, userId, displayName) {
    // Build the subset of fields that actually changed
    const updatePayload = {};
    const fieldMapping = {
        'Item Name': 'itemName',   // standardized — was 'name'
        'Price': 'vendorPrice',
        'Category': 'category',
        'Brand': 'brand',
        'Pack Size': 'packSize',
        'Unit': 'unit',
        'Status': 'status',
        'Vendor SKU': 'vendorSKU',
        'Min Order Qty': 'minOrderQty',
        'Lead Time Days': 'leadTimeDays',
        'Notes': 'notes',
        'Currency': 'currency',
    };

    changedFields.forEach(label => {
        const key = fieldMapping[label];
        if (!key) return;
        if (key === 'vendorPrice') {
            updatePayload[key] = parseFloat(normalizedRow.price) || 0;
        } else if (key === 'itemName') {   // standardized field name
            updatePayload[key] = normalizedRow.itemName;
            updatePayload['itemNameNormalized'] = normalizeString(normalizedRow.itemName);
        } else if (key === 'packSize') {
            updatePayload[key] = normalizedRow.packSize;
            updatePayload['packSizeNormalized'] = normalizeString(normalizedRow.packSize);
        } else if (key === 'unit') {
            updatePayload[key] = normalizedRow.unit;
            updatePayload['unitNormalized'] = normalizeUnit(normalizedRow.unit);
        } else if (key === 'minOrderQty' || key === 'leadTimeDays') {
            updatePayload[key] = normalizedRow[key.replace('TimeDays', '_leadTimeDays')] || normalizedRow.minOrderQty || normalizedRow.leadTimeDays || '';
        } else {
            // Map label to row key
            const rowKeyMap = { category: 'category', brand: 'brand', status: 'status', vendorSKU: 'vendorSKU', notes: 'notes', currency: 'currency' };
            if (rowKeyMap[key]) updatePayload[key] = normalizedRow[rowKeyMap[key]] || '';
        }
    });

    // Always update meta fields
    updatePayload.updatedAt = serverTimestamp();
    updatePayload.updatedBy = displayName || userId || 'Import';
    updatePayload.sourceLastUpdated = 'import';
    updatePayload.lastImportBatchId = batchId;

    const itemRef = doc(db, 'vendors', vendorId, 'items', itemId);
    await updateDoc(itemRef, updatePayload);

    // Write history
    await writeItemHistory(vendorId, itemId, {
        changedAt: serverTimestamp(),
        changedBy: displayName || userId || 'Import',
        changeSource: 'import',
        importBatchId: batchId,
        changedFields,
        oldValues,
        newValues: changedFields.reduce((acc, label) => {
            acc[label] = updatePayload[fieldMapping[label]] ?? '';
            return acc;
        }, {}),
    });
}

// ── Write item history ─────────────────────────────────────────────────────────

export async function writeItemHistory(vendorId, itemId, historyEntry) {
    const historyRef = collection(db, 'vendors', vendorId, 'items', itemId, 'history');
    await addDoc(historyRef, historyEntry);
}

// ── Create import batch record ────────────────────────────────────────────────

/**
 * createImportBatch(vendorId, meta)
 * Creates the batch header in vendors/{vendorId}/importBatches/.
 * Returns the new batch document ID.
 * meta: { fileName, importMode, uploadedBy, vendorName, totalRows }
 */
export async function createImportBatch(vendorId, meta) {
    const batchRef = await addDoc(collection(db, 'vendors', vendorId, 'importBatches'), {
        vendorId,
        fileName: meta.fileName || '',
        importMode: meta.importMode || 'add_and_update',
        uploadedBy: meta.uploadedBy || '',
        uploadedByName: meta.uploadedByName || '',
        uploadedAt: serverTimestamp(),
        totalRows: meta.totalRows || 0,
        createdCount: 0,
        updatedHighCount: 0,
        updatedMediumCount: 0,
        unchangedCount: 0,
        warningCount: 0,
        errorCount: 0,
        reviewCount: 0,
        skippedCount: 0,
        status: 'in_progress',
        templateVersion: '1.0',
    });
    return batchRef.id;
}

/**
 * finalizeBatch(vendorId, batchId, counts)
 * Updates the batch document with final counts and status.
 */
export async function finalizeBatch(vendorId, batchId, counts) {
    const batchRef = doc(db, 'vendors', vendorId, 'importBatches', batchId);
    await updateDoc(batchRef, {
        ...counts,
        status: 'completed',
        completedAt: serverTimestamp(),
    });
}

// ── Write per-row results ──────────────────────────────────────────────────────

/**
 * writeBatchRowResults(vendorId, batchId, rows)
 * Writes individual row results to importBatches/{batchId}/rows/ subcollection.
 * Batches writes in groups of 20 to avoid overwhelming Firestore.
 */
export async function writeBatchRowResults(vendorId, batchId, rows) {
    const rowsRef = collection(db, 'vendors', vendorId, 'importBatches', batchId, 'rows');
    const chunks = chunkArray(rows, 20);
    for (const chunk of chunks) {
        await Promise.all(
            chunk.map((row, idx) =>
                addDoc(rowsRef, {
                    rowNumber: row._rowNumber || idx + 1,
                    rawData: {
                        itemName: row.itemName || '',
                        price: row.price || '',
                        category: row.category || '',
                        brand: row.brand || '',
                        packSize: row.packSize || '',
                        unit: row.unit || '',
                        status: row.status || '',
                        vendorSKU: row.vendorSKU || '',
                    },
                    matchType: row.matchType || 'none',
                    matchedItemId: row.matchedItemId || null,
                    actionTaken: row.actionResult || 'none',
                    changedFields: row.changedFields || [],
                    oldValues: row.oldValues || {},
                    newValues: row.newValues || {},
                    warningMessages: row.warnings || [],
                    errorMessages: row.errors || [],
                    excluded: row._excluded || false,
                    createdItemId: row._createdItemId || null,
                })
            )
        );
    }
}

function chunkArray(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
    return result;
}

// ── Process full import batch ─────────────────────────────────────────────────

/**
 * processImportBatch(vendorId, matchedRows, batchId, userId, displayName)
 *
 * Iterates over matched rows and calls create/update depending on actionResult.
 * Skips excluded rows, error rows, unchanged rows, and potential_match rows.
 * Returns updated counts.
 */
export async function processImportBatch(vendorId, matchedRows, batchId, userId, displayName) {
    let createdCount = 0;
    let updatedHighCount = 0;
    let updatedMediumCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;
    let reviewCount = 0;
    let skippedCount = 0;
    let warningCount = 0;

    const processedRows = [];

    for (const row of matchedRows) {
        if (row._excluded) { skippedCount++; processedRows.push(row); continue; }
        if (row.warnings && row.warnings.length > 0) warningCount++;

        // Auto-skip categories
        if (row.actionResult === 'error')       { errorCount++;   processedRows.push(row); continue; }
        if (row.actionResult === 'unchanged')   { unchangedCount++;processedRows.push(row); continue; }
        if (row.actionResult === 'skip')        { skippedCount++; processedRows.push(row); continue; }
        if (row.actionResult === 'needs_review') {
            reviewCount++;
            processedRows.push(row);
            // ── Route to catalogReviewQueue so superadmin can resolve it ──
            try {
                await createCatalogReviewQueueEntry({
                    vendorId,
                    vendorName: displayName || vendorId,
                    vendorItemId: row.matchedItemId || '',
                    importBatchId: batchId,
                    importRowId: row._rowNumber ? String(row._rowNumber) : '',
                    reviewType: 'needs_review',
                    proposedData: {
                        itemName:    row.itemName,
                        category:    row.category,
                        brand:       row.brand,
                        packSize:    row.packSize,
                        unit:        row.unit,
                        price:       row.price,
                        currency:    row.currency || 'CAD',
                        vendorSKU:   row.vendorSKU,
                        minOrderQty: row.minOrderQty,
                        status:      row.status,
                        notes:       row.notes,
                    },
                    existingVendorItemData: row.oldValues || {},
                    suggestedCatalogMatches: row.ambiguousCandidates || [],
                    suggestedVendorMatches:  [],
                    matchConfidence: row.confidence || null,
                    riskFlags: buildRiskFlags(row, row.oldValues || null),
                    reviewReason: row.reason || 'Ambiguous match — needs manual review',
                    createdBy: displayName || userId,
                });
            } catch (queueErr) {
                console.warn('[importFirestore] needs_review queue entry failed:', queueErr);
            }
            continue;
        }



        try {
            // ── NEW ITEMS → Vendor item (pending_review) + catalogReviewQueue entry ──
            if (row.actionResult === 'new_item' || row.actionResult === 'new_possible_duplicate') {
                // Create vendor item as pending_review so vendor can see it
                const newId = await createVendorItem(vendorId, row, batchId, userId, displayName, {
                    mappingStatus: 'pending_review',
                    status: 'Pending Review',
                });
                createdCount++;
                processedRows.push({ ...row, _createdItemId: newId });

                // Write review queue entry for superadmin
                await createCatalogReviewQueueEntry({
                    vendorId,
                    vendorName: displayName || vendorId,
                    vendorItemId: newId,
                    importBatchId: batchId,
                    importRowId: row._rowNumber ? String(row._rowNumber) : '',
                    reviewType: row.actionResult === 'new_possible_duplicate' ? 'possible_duplicate' : 'new_item',
                    proposedData: {
                        itemName:    row.itemName,
                        category:    row.category,
                        brand:       row.brand,
                        packSize:    row.packSize,
                        unit:        row.unit,
                        price:       row.price,
                        currency:    row.currency || 'CAD',
                        vendorSKU:   row.vendorSKU,
                        minOrderQty: row.minOrderQty,
                        status:      row.status,
                        notes:       row.notes,
                    },
                    existingVendorItemData: {},
                    suggestedCatalogMatches: row.ambiguousCandidates || [],
                    suggestedVendorMatches:  [],
                    matchConfidence: row.confidence || null,
                    riskFlags: buildRiskFlags(row, null),
                    reviewReason: row.reason || row.actionResult,
                    createdBy: displayName || userId,
                });

            // ── HIGH RISK → Apply vendor item update + write review queue entry ──
            } else if (row.actionResult === 'high_risk_review') {
                // Apply the update (user explicitly included this row) but flag for review
                if (row.matchedItemId) {
                    await updateVendorItem(
                        vendorId, row.matchedItemId, row,
                        row.oldValues, row.changedFields, batchId, userId, displayName
                    );
                    updatedMediumCount++;
                }
                processedRows.push(row);

                // Write review queue entry so superadmin can audit the high-risk update
                await createCatalogReviewQueueEntry({
                    vendorId,
                    vendorName: displayName || vendorId,
                    vendorItemId: row.matchedItemId || '',
                    importBatchId: batchId,
                    importRowId: row._rowNumber ? String(row._rowNumber) : '',
                    reviewType: 'high_risk_update',
                    proposedData: {
                        itemName:  row.itemName,
                        category:  row.category,
                        packSize:  row.packSize,
                        unit:      row.unit,
                        price:     row.price,
                        currency:  row.currency || 'CAD',
                        vendorSKU: row.vendorSKU,
                        status:    row.status,
                        notes:     row.notes,
                    },
                    existingVendorItemData: row.oldValues || {},
                    suggestedCatalogMatches: [],
                    suggestedVendorMatches:  [],
                    matchConfidence: row.confidence || null,
                    riskFlags: row._riskReasons || buildRiskFlags(row, row.oldValues || {}),
                    reviewReason: (row._riskReasons || []).join('; ') || 'High-risk update applied by vendor',
                    createdBy: displayName || userId,
                });

            // ── HIGH CONFIDENCE UPDATES → Direct write, no queue entry ──
            } else if (row.actionResult === 'update_high') {
                await updateVendorItem(
                    vendorId, row.matchedItemId, row,
                    row.oldValues, row.changedFields, batchId, userId, displayName
                );
                updatedHighCount++;
                processedRows.push(row);

            // ── MEDIUM CONFIDENCE — user kept it, apply directly ──
            } else if (row.actionResult === 'update_medium' || row._userAction === 'update_high') {
                await updateVendorItem(
                    vendorId, row.matchedItemId, row,
                    row.oldValues, row.changedFields, batchId, userId, displayName
                );
                updatedMediumCount++;
                processedRows.push(row);

            } else {
                // Fallback — skip anything else
                skippedCount++;
                processedRows.push(row);
            }
        } catch (err) {
            console.error('[importFirestore] Row error:', err, row);
            errorCount++;
            processedRows.push({ ...row, actionResult: 'error', errors: [...(row.errors || []), 'Write failed: ' + err.message] });
        }
    }

    return {
        processedRows,
        counts: { createdCount, updatedHighCount, updatedMediumCount, unchangedCount, errorCount, reviewCount, skippedCount, warningCount },
    };
}
