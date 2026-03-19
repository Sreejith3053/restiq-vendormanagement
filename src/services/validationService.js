/**
 * validationService.js
 * 
 * Centralized data validation for the RestIQ platform.
 * 
 * Provides:
 * - Item/catalog validation (prices, units, duplicates, required fields)
 * - Price spike detection
 * - Dispatch validation
 * - Invoice validation
 */

/* ═══════════════════════════════════════════════════════════
   SECTION 1 — ITEM / CATALOG VALIDATION
   ═══════════════════════════════════════════════════════════ */

/**
 * Validate a catalog item before save/import.
 *
 * @param {Object} item
 * @param {Object} [options]
 * @param {Array}  [options.existingItems] - for duplicate detection
 * @param {Object} [options.previousVersion] - for price spike detection
 * @returns {Object} - { valid, errors[], warnings[] }
 */
export function validateCatalogItem(item, options = {}) {
    const errors = [];
    const warnings = [];

    // Required fields
    const name = (item.itemName || item.name || '').trim();
    if (!name) errors.push({ field: 'name', message: 'Item name is required' });

    // Price validation
    const price = parseFloat(item.vendorPrice ?? item.price ?? -1);
    if (isNaN(price) || price < 0) {
        errors.push({ field: 'price', message: 'Price cannot be negative' });
    } else if (price === 0) {
        warnings.push({ field: 'price', message: 'Price is zero — is this intentional?' });
    } else if (price > 5000) {
        warnings.push({ field: 'price', message: `Price $${price} seems unusually high` });
    }

    // Unit validation
    const validUnits = ['kg', 'lb', 'g', 'oz', 'each', 'pack', 'case', 'bag', 'box', 'bunch', 'dozen', 'pcs', 'liter', 'ml', 'gallon'];
    const unit = (item.unit || item.uom || '').toLowerCase().trim();
    if (unit && !validUnits.includes(unit)) {
        warnings.push({ field: 'unit', message: `Unit '${unit}' is non-standard. Expected: ${validUnits.join(', ')}` });
    }

    // Pack size
    if (!item.packSize && !item.packQuantity) {
        warnings.push({ field: 'packSize', message: 'Pack size is missing — may affect dispatch calculations' });
    }
    const packSize = parseFloat(item.packSize || item.packQuantity || 0);
    if (packSize < 0) {
        errors.push({ field: 'packSize', message: 'Pack size cannot be negative' });
    }

    // Category
    if (!item.category) {
        warnings.push({ field: 'category', message: 'Category is missing' });
    }

    // Duplicate detection
    if (options.existingItems && name) {
        const normalizedName = name.toLowerCase();
        const packKey = `${normalizedName}|${packSize}|${unit}`;
        const dupe = options.existingItems.find(existing => {
            const eName = (existing.itemName || existing.name || '').toLowerCase().trim();
            const ePack = parseFloat(existing.packSize || existing.packQuantity || 0);
            const eUnit = (existing.unit || existing.uom || '').toLowerCase().trim();
            return `${eName}|${ePack}|${eUnit}` === packKey && existing.id !== item.id;
        });
        if (dupe) {
            errors.push({ field: 'duplicate', message: `Duplicate item+pack found: "${name}" (${packSize} ${unit})` });
        }
    }

    // Price spike detection
    if (options.previousVersion) {
        const prevPrice = parseFloat(options.previousVersion.vendorPrice ?? options.previousVersion.price ?? 0);
        if (prevPrice > 0 && price > 0) {
            const changePercent = Math.abs((price - prevPrice) / prevPrice) * 100;
            if (changePercent > 50) {
                warnings.push({
                    field: 'priceSpike',
                    message: `Price changed ${changePercent.toFixed(0)}% (${prevPrice} → ${price}) — please verify`,
                });
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        errorCount: errors.length,
        warningCount: warnings.length,
    };
}

/**
 * Batch validate multiple items.
 *
 * @param {Array} items
 * @param {Object} [options]
 * @returns {Object} - { validCount, invalidCount, results[] }
 */
export function validateCatalogBatch(items, options = {}) {
    const results = items.map((item, index) => ({
        index,
        itemName: item.itemName || item.name || `Row ${index + 1}`,
        ...validateCatalogItem(item, { ...options, existingItems: options.existingItems || items }),
    }));

    return {
        validCount: results.filter(r => r.valid).length,
        invalidCount: results.filter(r => !r.valid).length,
        warningCount: results.filter(r => r.warningCount > 0).length,
        results,
    };
}

/* ═══════════════════════════════════════════════════════════
   SECTION 2 — DISPATCH VALIDATION
   ═══════════════════════════════════════════════════════════ */

/**
 * Validate dispatch data before creation/confirmation.
 */
export function validateDispatch(dispatch) {
    const errors = [];
    const warnings = [];

    if (!dispatch.vendorId) errors.push({ field: 'vendorId', message: 'Vendor ID is required' });
    if (!dispatch.weekStart && !dispatch.weekLabel) warnings.push({ field: 'weekStart', message: 'Week reference is missing' });

    const items = dispatch.items || [];
    if (items.length === 0) warnings.push({ field: 'items', message: 'No items in dispatch' });

    items.forEach((item, i) => {
        const qty = Number(item.requestedQty || item.qty || 0);
        if (qty <= 0) errors.push({ field: `items[${i}].qty`, message: `Item "${item.itemName || i}" has invalid quantity` });

        const confirmedQty = Number(item.confirmedQty ?? qty);
        if (confirmedQty < 0) errors.push({ field: `items[${i}].confirmedQty`, message: `Confirmed qty cannot be negative` });
        if (confirmedQty > qty * 2) warnings.push({ field: `items[${i}].confirmedQty`, message: `Confirmed qty (${confirmedQty}) is >2x requested (${qty})` });
    });

    return { valid: errors.length === 0, errors, warnings };
}

/* ═══════════════════════════════════════════════════════════
   SECTION 3 — INVOICE VALIDATION
   ═══════════════════════════════════════════════════════════ */

/**
 * Validate invoice data before generation.
 */
export function validateInvoice(invoice) {
    const errors = [];
    const warnings = [];

    if (!invoice.vendorId) errors.push({ field: 'vendorId', message: 'Vendor ID is required' });

    const subtotal = Number(invoice.subtotal || 0);
    if (subtotal < 0) errors.push({ field: 'subtotal', message: 'Subtotal cannot be negative' });
    if (subtotal === 0) warnings.push({ field: 'subtotal', message: 'Subtotal is zero' });

    const tax = Number(invoice.tax || 0);
    if (tax < 0) errors.push({ field: 'tax', message: 'Tax cannot be negative' });

    const commission = Number(invoice.commissionAmount || 0);
    if (commission < 0) errors.push({ field: 'commission', message: 'Commission cannot be negative' });

    const payout = Number(invoice.vendorPayoutAmount || 0);
    if (payout < 0) errors.push({ field: 'payout', message: 'Vendor payout cannot be negative' });

    // Consistency check
    if (subtotal > 0) {
        const expectedPayout = subtotal - commission;
        if (Math.abs(payout - expectedPayout) > 0.01) {
            warnings.push({ field: 'consistency', message: `Payout ($${payout}) ≠ subtotal ($${subtotal}) - commission ($${commission})` });
        }
    }

    const items = invoice.items || invoice.snapshotItems || [];
    if (items.length === 0) warnings.push({ field: 'items', message: 'No items in invoice' });

    return { valid: errors.length === 0, errors, warnings };
}
