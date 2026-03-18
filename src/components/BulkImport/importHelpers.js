/**
 * importHelpers.js
 *
 * Core helpers for the Vendor Bulk Import module.
 * - Parse Excel / CSV files (SheetJS)
 * - Export vendor catalog to .xlsx
 * - Generate downloadable import template
 * - Generate error report CSV
 */
import * as XLSX from 'xlsx';

// ── Column definitions ─────────────────────────────────────────────────────────

export const TEMPLATE_COLUMNS = [
    { key: 'vendorItemId',  header: 'vendorItemId (system)',   note: 'Leave blank for new items. Re-export and re-upload to use.' },
    { key: 'vendorSKU',     header: 'vendorSKU (optional)',    note: 'Your internal SKU. Optional.' },
    { key: 'itemName',      header: 'itemName *',              note: 'Required. Exact item name.' },
    { key: 'category',      header: 'category',                note: 'e.g. Produce, Meat, Packaging. Optional.' },
    { key: 'brand',         header: 'brand',                   note: 'Optional.' },
    { key: 'packSize',      header: 'packSize',                note: 'e.g. 10kg, 500g, 1L. Optional.' },
    { key: 'unit',          header: 'unit',                    note: 'e.g. kg, L, unit, case. Optional.' },
    { key: 'price',         header: 'price *',                 note: 'Required. Numeric. e.g. 12.99' },
    { key: 'currency',      header: 'currency',                note: 'Default: CAD. Optional.' },
    { key: 'minOrderQty',   header: 'minOrderQty',             note: 'Optional. Numeric.' },
    { key: 'leadTimeDays',  header: 'leadTimeDays',            note: 'Optional. Numeric.' },
    { key: 'status',        header: 'status',                  note: 'Active or Inactive. Default: Active.' },
    { key: 'notes',         header: 'notes',                   note: 'Optional internal notes.' },
];

export const TEMPLATE_NOTES_ROW = TEMPLATE_COLUMNS.reduce((acc, col) => {
    acc[col.header] = col.note;
    return acc;
}, {});

// ── Normalize helpers ──────────────────────────────────────────────────────────

export function normalizeString(str) {
    if (str === null || str === undefined) return '';
    return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeUnit(unit) {
    const u = normalizeString(unit);
    const map = { 'kgs': 'kg', 'lbs': 'lb', 'litre': 'l', 'litres': 'l', 'liter': 'l', 'liters': 'l', 'units': 'unit', 'pcs': 'unit', 'piece': 'unit', 'pieces': 'unit' };
    return map[u] || u;
}

// ── Parse Excel/CSV file ───────────────────────────────────────────────────────

/**
 * parseExcelFile(file)
 * Parses a .xlsx / .xls / .csv File object into an array of row objects.
 * Column headers are taken from row 1. Second row (if it begins with 'Leave blank') is skipped.
 * Returns { headers: string[], rows: object[], error: string|null }
 */
export function parseExcelFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

                if (!rawRows || rawRows.length < 2) {
                    resolve({ headers: [], rows: [], error: 'File appears to be empty or has no data rows.' });
                    return;
                }

                // Row 0 = headers
                const headers = rawRows[0].map(h => String(h).trim());

                // Skip row 1 if it looks like instructions (note row from template)
                let dataStart = 1;
                if (rawRows[1] && String(rawRows[1][0] || '').toLowerCase().startsWith('leave blank')) {
                    dataStart = 2;
                }

                const rows = [];
                for (let i = dataStart; i < rawRows.length; i++) {
                    const raw = rawRows[i];
                    // Skip fully empty rows
                    if (!raw || raw.every(cell => cell === '' || cell === null || cell === undefined)) continue;

                    const obj = {};
                    headers.forEach((h, idx) => {
                        // Strip notes suffix like " *" or " (optional)" or " (system)"
                        const cleanHeader = h.replace(/\s*\*\s*$/, '').replace(/\s*\(.*?\)\s*$/, '').trim();
                        // Map to canonical key
                        const canonical = HEADER_TO_KEY[cleanHeader.toLowerCase()] || cleanHeader;
                        obj[canonical] = raw[idx] !== undefined ? String(raw[idx]).trim() : '';
                    });
                    obj._rowNumber = i + 1; // 1-indexed original row
                    rows.push(obj);
                }

                resolve({ headers, rows, error: null });
            } catch (err) {
                resolve({ headers: [], rows: [], error: 'Could not parse file: ' + err.message });
            }
        };
        reader.onerror = () => resolve({ headers: [], rows: [], error: 'Failed to read file.' });
        reader.readAsArrayBuffer(file);
    });
}

// Flexible header aliasing — maps common alternate spellings to canonical keys
const HEADER_TO_KEY = {
    'vendoritemid': 'vendorItemId',
    'vendor item id': 'vendorItemId',
    'system id': 'vendorItemId',
    'vendorsku': 'vendorSKU',
    'vendor sku': 'vendorSKU',
    'sku': 'vendorSKU',
    'itemname': 'itemName',
    'item name': 'itemName',
    'name': 'itemName',
    'product name': 'itemName',
    'item': 'itemName',
    'category': 'category',
    'brand': 'brand',
    'packsize': 'packSize',
    'pack size': 'packSize',
    'pack': 'packSize',
    'unit': 'unit',
    'pricing unit': 'unit',
    'price': 'price',
    'cost': 'price',
    'unit price': 'price',
    'vendor price': 'price',
    'currency': 'currency',
    'minorderqty': 'minOrderQty',
    'min order qty': 'minOrderQty',
    'min qty': 'minOrderQty',
    'minimum order': 'minOrderQty',
    'leadtimedays': 'leadTimeDays',
    'lead time': 'leadTimeDays',
    'lead time days': 'leadTimeDays',
    'status': 'status',
    'notes': 'notes',
    'note': 'notes',
    'description': 'notes',
};

// ── Download Template ──────────────────────────────────────────────────────────

export function downloadTemplate() {
    const headers = TEMPLATE_COLUMNS.map(c => c.header);
    const noteRow = TEMPLATE_COLUMNS.map(c => c.note);

    // Example data row
    const exampleRow = [
        '', '', 'Cooking Oil 5L', 'Produce', 'Eastern', '5L', 'unit', '22.50', 'CAD', '10', '3', 'Active', 'Bulk cooking oil'
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, noteRow, exampleRow]);

    // Style header row wider
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 2 ? 30 : 18 }));

    XLSX.utils.book_append_sheet(wb, ws, 'Import Template');
    XLSX.writeFile(wb, 'RestIQ_Import_Template.xlsx');
}

// ── Export Vendor Catalog ──────────────────────────────────────────────────────

export function exportVendorCatalog(items, vendorName) {
    const headers = TEMPLATE_COLUMNS.map(c => c.header);

    const rows = items.map(item => [
        item.id || '',
        item.vendorSKU || '',
        item.name || '',
        item.category || '',
        item.brand || '',
        item.packSize || '',
        item.unit || '',
        item.vendorPrice ?? item.price ?? '',
        item.currency || 'CAD',
        item.minOrderQty || '',
        item.leadTimeDays || '',
        item.status || 'Active',
        item.notes || '',
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i === 2 ? 30 : 18 }));

    XLSX.utils.book_append_sheet(wb, ws, 'Catalog');
    const safeVendorName = (vendorName || 'Vendor').replace(/[^a-z0-9]/gi, '_');
    XLSX.writeFile(wb, safeVendorName + '_Catalog.xlsx');
}

// ── Generate Error Report ──────────────────────────────────────────────────────

export function generateErrorReport(errorRows) {
    const headers = ['Row #', 'Item Name', 'Category', 'Price', 'Unit', 'Error Message', 'Warning Message', 'Suggested Fix'];
    const data = errorRows.map(r => [
        r._rowNumber || '',
        r.itemName || '',
        r.category || '',
        r.price || '',
        r.unit || '',
        (r.errors || []).join('; '),
        (r.warnings || []).join('; '),
        r.suggestedFix || 'Review and correct the values above',
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [6, 30, 16, 10, 10, 40, 40, 40].map(w => ({ wch: w }));

    XLSX.utils.book_append_sheet(wb, ws, 'Error Report');
    XLSX.writeFile(wb, 'Import_Error_Report.xlsx');
}
