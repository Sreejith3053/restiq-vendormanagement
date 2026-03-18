/**
 * importValidation.js
 *
 * Validation logic for vendor bulk import.
 * - File-level validation (type, size, not empty)
 * - Row-level validation (required fields, numeric types, value ranges)
 * - Cross-row duplicate detection within the uploaded file
 */
import { normalizeString } from './importHelpers';

// ── File-level validation ──────────────────────────────────────────────────────

const ALLOWED_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv',
    'application/csv',
    '',  // Some CSVs have empty type
];

const MAX_FILE_SIZE_MB = 10;

/**
 * validateFile(file) → { valid: bool, error: string|null }
 */
export function validateFile(file) {
    if (!file) return { valid: false, error: 'No file selected.' };

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        return { valid: false, error: 'Unsupported file type. Please upload .xlsx, .xls, or .csv' };
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        return { valid: false, error: 'File is too large. Maximum size is ' + MAX_FILE_SIZE_MB + 'MB.' };
    }

    if (file.size === 0) {
        return { valid: false, error: 'File appears to be empty.' };
    }

    return { valid: true, error: null };
}

// ── Row-level validation ───────────────────────────────────────────────────────

const VALID_STATUSES = ['active', 'inactive', 'Active', 'Inactive', ''];

/**
 * validateRow(rawRow, rowIndex) → { valid: bool, errors: string[], warnings: string[], suggestedFix: string }
 *
 * Validated fields:
 *   - itemName: required, non-empty
 *   - price: required, numeric, >= 0
 *   - status: if provided must be 'Active' or 'Inactive'
 *   - minOrderQty: if provided must be numeric
 *   - leadTimeDays: if provided must be numeric
 */
export function validateRow(rawRow, rowIndex) {
    const errors = [];
    const warnings = [];
    let suggestedFix = '';

    // itemName
    const itemName = (rawRow.itemName || '').trim();
    if (!itemName) {
        errors.push('itemName is required and cannot be blank.');
        suggestedFix = 'Add the item name in the itemName column.';
    } else if (itemName.length < 2) {
        warnings.push('itemName is very short — confirm this is correct.');
    }

    // price
    const priceRaw = String(rawRow.price || '').trim().replace(/[$,]/g, '');
    if (!priceRaw) {
        errors.push('price is required and cannot be blank.');
        suggestedFix += ' Add a numeric price.';
    } else {
        const price = parseFloat(priceRaw);
        if (isNaN(price)) {
            errors.push('price must be a number (got: "' + rawRow.price + '").');
            suggestedFix += ' Remove currency symbols and ensure price is numeric.';
        } else if (price < 0) {
            errors.push('price cannot be negative.');
        } else if (price === 0) {
            warnings.push('price is 0 — confirm this is intentional.');
        } else if (price > 100000) {
            warnings.push('price looks unusually high (' + price + '). Confirm this is correct.');
        }
    }

    // status
    const statusRaw = (rawRow.status || '').trim();
    if (statusRaw && !VALID_STATUSES.includes(statusRaw)) {
        errors.push('status must be "Active" or "Inactive" (got: "' + statusRaw + '").');
        suggestedFix += ' Fix status value.';
    }

    // minOrderQty (optional)
    const mqRaw = (rawRow.minOrderQty || '').trim();
    if (mqRaw) {
        const mq = parseFloat(mqRaw);
        if (isNaN(mq) || mq < 0) {
            warnings.push('minOrderQty must be a positive number if provided (got: "' + mqRaw + '").');
        }
    }

    // leadTimeDays (optional)
    const ltRaw = (rawRow.leadTimeDays || '').trim();
    if (ltRaw) {
        const lt = parseFloat(ltRaw);
        if (isNaN(lt) || lt < 0) {
            warnings.push('leadTimeDays must be a positive number if provided (got: "' + ltRaw + '").');
        }
    }

    // Warn if unit and packSize are both blank (not required but recommended)
    if (!rawRow.unit && !rawRow.packSize) {
        warnings.push('unit and packSize are both blank — provide at least unit for accurate matching.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        suggestedFix: suggestedFix.trim(),
    };
}

// ── Cross-row duplicate detection ─────────────────────────────────────────────

/**
 * detectDuplicateRows(rows) → rows with _isDuplicate and _duplicateOf flags added.
 * Detects rows within the uploaded file that share the same normalized match key.
 * The FIRST occurrence is kept; subsequent ones are flagged.
 */
export function detectDuplicateRows(rows) {
    const seen = {}; // matchKey → first rowIndex

    return rows.map((row, idx) => {
        const key = buildInFileKey(row);
        if (!key) return row;

        if (seen[key] !== undefined) {
            return {
                ...row,
                _isDuplicate: true,
                _duplicateOf: seen[key] + 1, // 1-indexed row number of first occurrence
                warnings: [...(row.warnings || []), 'Duplicate of row ' + (seen[key] + 1) + ' in this file.'],
            };
        }

        seen[key] = idx;
        return row;
    });
}

function buildInFileKey(row) {
    const name = normalizeString(row.itemName);
    if (!name) return null;
    const packSize = normalizeString(row.packSize || '');
    const unit = normalizeString(row.unit || '');
    const sku = normalizeString(row.vendorSKU || '');
    // Use SKU if available for tighter key
    if (sku) return 'sku:' + sku;
    return [name, packSize, unit].join('|');
}

// ── Validate all rows in batch ─────────────────────────────────────────────────

/**
 * validateAllRows(rows)
 * Runs validateRow on each row, then detectDuplicateRows.
 * Returns annotated rows with .errors, .warnings, .valid added.
 */
export function validateAllRows(rows) {
    const annotated = rows.map((row, idx) => {
        const result = validateRow(row, idx);
        return {
            ...row,
            errors: result.errors,
            warnings: result.warnings,
            suggestedFix: result.suggestedFix,
            _valid: result.valid,
        };
    });
    return detectDuplicateRows(annotated);
}
