/**
 * catalogValidation.js
 *
 * Catalog integrity validation — detects unit mismatches, price anomalies,
 * category mismatches, and validates safe merges.
 *
 * Surface flags in:
 *   - Catalog & Reviews → Review Queue
 *   - Control Tower → Exceptions
 */

// ── Unit Normalization ──────────────────────────────────────────────────────

const UNIT_FAMILIES = {
    weight_metric: ['kg', 'g', 'gram', 'grams', 'kilogram', 'kilograms'],
    weight_imperial: ['lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces'],
    volume_metric: ['l', 'ml', 'litre', 'liter', 'litres', 'liters', 'millilitre', 'milliliter'],
    volume_imperial: ['gal', 'gallon', 'gallons', 'qt', 'quart', 'fl oz', 'fluid ounce'],
    count: ['ea', 'each', 'unit', 'piece', 'pc', 'pcs', 'pieces'],
    case: ['case', 'cases', 'cs', 'box', 'boxes', 'bx', 'crate', 'crates'],
    pack: ['pack', 'packs', 'pk', 'bag', 'bags', 'bundle', 'bundles'],
};

function getUnitFamily(unit) {
    const norm = (unit || '').toLowerCase().trim();
    for (const [family, units] of Object.entries(UNIT_FAMILIES)) {
        if (units.includes(norm)) return family;
    }
    return 'unknown';
}

/**
 * Detect unit mismatch between vendor item and catalog item.
 *
 * @param {Object} vendorItem - { unit, baseUnit }
 * @param {Object} catalogItem - { unit, baseUnit }
 * @returns {{ mismatch: boolean, severity: 'high'|'medium'|'low', details: string }}
 */
export function detectUnitMismatch(vendorItem, catalogItem) {
    const vendorUnit = vendorItem?.baseUnit || vendorItem?.unit || 'unit';
    const catalogUnit = catalogItem?.baseUnit || catalogItem?.unit || 'unit';

    const vendorFamily = getUnitFamily(vendorUnit);
    const catalogFamily = getUnitFamily(catalogUnit);

    if (vendorFamily === catalogFamily) {
        return { mismatch: false, severity: 'low', details: '' };
    }

    // Cross-family mismatch (kg vs lb) is high severity
    const isCrossSystem =
        (vendorFamily === 'weight_metric' && catalogFamily === 'weight_imperial') ||
        (vendorFamily === 'weight_imperial' && catalogFamily === 'weight_metric') ||
        (vendorFamily === 'volume_metric' && catalogFamily === 'volume_imperial') ||
        (vendorFamily === 'volume_imperial' && catalogFamily === 'volume_metric');

    if (isCrossSystem) {
        return {
            mismatch: true,
            severity: 'high',
            details: `Unit system mismatch: vendor uses "${vendorUnit}" (${vendorFamily}) but catalog uses "${catalogUnit}" (${catalogFamily})`,
        };
    }

    // Different families entirely (e.g., weight vs count)
    return {
        mismatch: true,
        severity: 'medium',
        details: `Unit type mismatch: vendor "${vendorUnit}" (${vendorFamily}) vs catalog "${catalogUnit}" (${catalogFamily})`,
    };
}

/**
 * Detect extreme price deviation between vendor price and catalog average.
 *
 * @param {number} vendorPrice - Current vendor price
 * @param {number} catalogAvgPrice - Average/reference price
 * @param {Object} [options]
 * @param {number} [options.highThreshold=0.50] - 50% deviation = high severity
 * @param {number} [options.mediumThreshold=0.25] - 25% deviation = medium severity
 * @returns {{ anomaly: boolean, severity: 'high'|'medium'|'low', deviation: number, details: string }}
 */
export function detectPriceAnomaly(vendorPrice, catalogAvgPrice, options = {}) {
    const { highThreshold = 0.50, mediumThreshold = 0.25 } = options;

    const vp = Number(vendorPrice || 0);
    const cap = Number(catalogAvgPrice || 0);

    if (cap === 0 || vp === 0) {
        return { anomaly: false, severity: 'low', deviation: 0, details: 'Insufficient price data' };
    }

    const deviation = Math.abs(vp - cap) / cap;

    if (deviation >= highThreshold) {
        const pct = (deviation * 100).toFixed(0);
        const dir = vp > cap ? 'higher' : 'lower';
        return {
            anomaly: true,
            severity: 'high',
            deviation: round2(deviation),
            details: `Price ${pct}% ${dir} than catalog average ($${vp.toFixed(2)} vs $${cap.toFixed(2)})`,
        };
    }

    if (deviation >= mediumThreshold) {
        const pct = (deviation * 100).toFixed(0);
        const dir = vp > cap ? 'higher' : 'lower';
        return {
            anomaly: true,
            severity: 'medium',
            deviation: round2(deviation),
            details: `Price ${pct}% ${dir} than catalog average ($${vp.toFixed(2)} vs $${cap.toFixed(2)})`,
        };
    }

    return { anomaly: false, severity: 'low', deviation: round2(deviation), details: '' };
}

/**
 * Detect category mismatch between vendor item and catalog item.
 *
 * @param {string} vendorCategory
 * @param {string} catalogCategory
 * @returns {{ mismatch: boolean, details: string }}
 */
export function detectCategoryMismatch(vendorCategory, catalogCategory) {
    const vc = (vendorCategory || '').toLowerCase().trim();
    const cc = (catalogCategory || '').toLowerCase().trim();

    if (!vc || !cc) return { mismatch: false, details: '' };
    if (vc === cc) return { mismatch: false, details: '' };

    return {
        mismatch: true,
        details: `Category mismatch: vendor "${vendorCategory}" vs catalog "${catalogCategory}"`,
    };
}

/**
 * Validate that a merge between two items is safe.
 *
 * @param {Object} sourceItem - Item being merged from
 * @param {Object} targetItem - Item being merged into
 * @returns {{ safe: boolean, warnings: string[] }}
 */
export function validateMerge(sourceItem, targetItem) {
    const warnings = [];

    if (!sourceItem || !targetItem) {
        return { safe: false, warnings: ['Both source and target items are required'] };
    }

    // Check category match
    const catResult = detectCategoryMismatch(sourceItem.category, targetItem.category);
    if (catResult.mismatch) warnings.push(catResult.details);

    // Check unit compatibility
    const unitResult = detectUnitMismatch(sourceItem, targetItem);
    if (unitResult.mismatch) warnings.push(unitResult.details);

    // Check for orphan mappings
    if (sourceItem.vendorMappings && Object.keys(sourceItem.vendorMappings).length > 0) {
        warnings.push(`Source item has ${Object.keys(sourceItem.vendorMappings).length} vendor mappings that must be transferred`);
    }

    // Check price deviation
    const priceResult = detectPriceAnomaly(
        sourceItem.vendorPrice || sourceItem.price,
        targetItem.vendorPrice || targetItem.price
    );
    if (priceResult.severity === 'high') {
        warnings.push(priceResult.details);
    }

    return {
        safe: warnings.length === 0,
        warnings,
    };
}

/**
 * Run all validations on a vendor item against its catalog mapping.
 *
 * @param {Object} vendorItem
 * @param {Object} catalogItem
 * @returns {{ flags: Array<{ type: string, severity: string, details: string }>, hasIssues: boolean }}
 */
export function validateCatalogMapping(vendorItem, catalogItem) {
    const flags = [];

    const unitCheck = detectUnitMismatch(vendorItem, catalogItem);
    if (unitCheck.mismatch) {
        flags.push({ type: 'unit_mismatch', severity: unitCheck.severity, details: unitCheck.details });
    }

    const priceCheck = detectPriceAnomaly(
        vendorItem?.vendorPrice || vendorItem?.price,
        catalogItem?.vendorPrice || catalogItem?.price || catalogItem?.avgPrice
    );
    if (priceCheck.anomaly) {
        flags.push({ type: 'price_anomaly', severity: priceCheck.severity, details: priceCheck.details });
    }

    const catCheck = detectCategoryMismatch(vendorItem?.category, catalogItem?.category);
    if (catCheck.mismatch) {
        flags.push({ type: 'category_mismatch', severity: 'medium', details: catCheck.details });
    }

    return {
        flags,
        hasIssues: flags.length > 0,
        highSeverityCount: flags.filter(f => f.severity === 'high').length,
    };
}

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}
