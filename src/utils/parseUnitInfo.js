/**
 * parseUnitInfo.js
 *
 * Safely parses a vendor unit string into structured components.
 *
 * PRIORITY ORDER (most specific → least specific):
 *   1. Parenthetical pack pattern  - "lb (50lb)", "case (25lb)", "bag (10kg)"
 *   2. Known scalar units          - "unit", "each", "piece"  → packSize 1
 *   3. Known weight/volume unit    - "kg", "lb", "oz"         → packSize 1
 *   4. Opaque containers           - "bundle", "bag", "case"  → packSize null
 *   5. Inline "50lb" style         - packed number+unit
 *   6. Unknown                     - normalizedPossible false
 *
 * Examples:
 *   "lb (50lb)"   → { salesUnit:"lb",    baseUnit:"lb",   packSize:50,  normalizedPossible:true  }
 *   "lb (25lb)"   → { salesUnit:"lb",    baseUnit:"lb",   packSize:25,  normalizedPossible:true  }
 *   "case (25lb)" → { salesUnit:"case",  baseUnit:"lb",   packSize:25,  normalizedPossible:true  }
 *   "case (100)"  → { salesUnit:"case",  baseUnit:"unit", packSize:100, normalizedPossible:true  }
 *   "bag (10kg)"  → { salesUnit:"bag",   baseUnit:"kg",   packSize:10,  normalizedPossible:true  }
 *   "lb"          → { salesUnit:"lb",    baseUnit:"lb",   packSize:1,   normalizedPossible:true  }
 *   "kg"          → { salesUnit:"kg",    baseUnit:"kg",   packSize:1,   normalizedPossible:true  }
 *   "bundle"      → { salesUnit:"bundle",baseUnit:null,   packSize:null,normalizedPossible:false }
 *   "bag"         → { salesUnit:"bag",   baseUnit:null,   packSize:null,normalizedPossible:false }
 *   "unit"        → { salesUnit:"unit",  baseUnit:"unit", packSize:1,   normalizedPossible:true  }
 *   "" / null     → { salesUnit:null,    baseUnit:null,   packSize:null,normalizedPossible:false }
 */

// Canonical map: lowercase raw token → display unit
const BASE_UNIT_CANONICAL = {
    kg: 'kg', kilogram: 'kg', kilograms: 'kg',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    g: 'g', gram: 'g', grams: 'g',
    l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L',
    ml: 'mL', milliliter: 'mL', millilitre: 'mL', milliliters: 'mL',
    gallon: 'gal', gal: 'gal',
};

// Scalar (count-based) units — packSize=1, baseUnit="unit"
const SCALAR_UNITS = new Set(['unit', 'each', 'ea', 'piece', 'pc', 'pcs', 'item', 'ct', 'count']);

// Opaque containers — cannot normalize without explicit parenthetical size
const OPAQUE_UNITS = new Set(['bundle', 'bag', 'case', 'box', 'pack', 'packet', 'sleeve', 'tray', 'pail', 'bucket', 'dozen', 'can', 'jar', 'bottle', 'jug']);

/**
 * Try to extract { baseUnit, quantity } from a fragment like "50lb", "25 lb", "10kg", "100"
 * Returns null if nothing recognisable is found.
 */
function extractFromFragment(fragment) {
    if (!fragment) return null;

    // Pattern: number then optional space then unit letters  e.g. "50lb",  "25 lb", "10.5 kg"
    const match = fragment.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$/);
    if (match) {
        const qty = parseFloat(match[1]);
        const canonical = BASE_UNIT_CANONICAL[match[2].toLowerCase()];
        if (canonical) return { baseUnit: canonical, quantity: qty };
        // Has letters but not a known unit — skip
        return null;
    }

    // Pure number only (e.g. "100") → count-based
    const numOnly = fragment.trim().match(/^(\d+(?:\.\d+)?)\s*$/);
    if (numOnly) return { baseUnit: 'unit', quantity: parseFloat(numOnly[1]) };

    return null;
}

/**
 * Main export: parse a raw unit string from Firestore.
 */
export function parseUnitInfo(unitString) {
    const EMPTY = { salesUnit: null, baseUnit: null, packSize: null, normalizedPossible: false };

    if (!unitString || typeof unitString !== 'string') return EMPTY;

    const trimmed = unitString.trim();
    if (!trimmed) return EMPTY;

    // ── STEP 1: Parenthetical pattern (HIGHEST PRIORITY) ─────────────────────
    // Matches: "lb (50lb)", "case (25lb)", "bag (10kg)", "case (100)"
    // Regex: capture everything before '(' as salesPart, everything inside '()' as content
    const parenMatch = trimmed.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);

    if (parenMatch) {
        const salesRaw = parenMatch[1].trim().toLowerCase();
        const parenContent = parenMatch[2].trim();
        const salesUnit = salesRaw || null;

        const extracted = extractFromFragment(parenContent);
        if (extracted) {
            return {
                salesUnit,
                baseUnit: extracted.baseUnit,
                packSize: extracted.quantity,
                normalizedPossible: true,
            };
        }
        // Parenthetical content not parseable — return salesUnit, mark not normalizable
        return { salesUnit, baseUnit: null, packSize: null, normalizedPossible: false };
    }

    // ── STEP 2: No parenthetical — classify the plain string ─────────────────
    const lower = trimmed.toLowerCase();

    // Scalar units (unit, each, piece…)
    if (SCALAR_UNITS.has(lower)) {
        return { salesUnit: lower, baseUnit: 'unit', packSize: 1, normalizedPossible: true };
    }

    // Known weight/volume base unit standing alone (e.g. "kg", "lb")
    const canonical = BASE_UNIT_CANONICAL[lower];
    if (canonical) {
        return { salesUnit: lower, baseUnit: canonical, packSize: 1, normalizedPossible: true };
    }

    // Opaque containers without size info → NOT normalizable
    if (OPAQUE_UNITS.has(lower)) {
        return { salesUnit: lower, baseUnit: null, packSize: null, normalizedPossible: false };
    }

    // Inline combined string "50lb", "1.5kg" (no spaces)
    const inlineMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
    if (inlineMatch) {
        const qty = parseFloat(inlineMatch[1]);
        const can = BASE_UNIT_CANONICAL[inlineMatch[2].toLowerCase()];
        if (can) {
            return { salesUnit: can, baseUnit: can, packSize: qty, normalizedPossible: true };
        }
    }

    // Unknown string — return salesUnit, mark not normalizable
    return { salesUnit: trimmed.toLowerCase() || null, baseUnit: null, packSize: null, normalizedPossible: false };
}

/**
 * Format pack size for display.
 * formatPackSize(50, "lb")   → "50 lb"
 * formatPackSize(null, null) → "—"
 */
export function formatPackSize(packSize, baseUnit) {
    if (packSize === null || packSize === undefined) return '—';
    return `${packSize} ${baseUnit || ''}`.trim();
}

/**
 * Format normalized unit price for display.
 * formatUnitPrice(19.80, 50, "lb") → "$0.396/lb"
 * Returns null when inputs are invalid.
 */
export function formatUnitPrice(price, packSize, baseUnit) {
    if (
        price === null || price === undefined || isNaN(price) ||
        packSize === null || packSize === undefined || packSize <= 0 ||
        !baseUnit
    ) return null;
    return `$${(price / packSize).toFixed(3)}/${baseUnit}`;
}

/**
 * Compute raw pricePerBaseUnit (for KPI aggregation and comparisons).
 * Returns null when not computable.
 */
export function computePricePerBaseUnit(price, packSize) {
    if (
        price === null || price === undefined || isNaN(price) ||
        packSize === null || packSize === undefined || packSize <= 0
    ) return null;
    return price / packSize;
}

// ── Dev-mode parse test (remove in production) ─────────────────────────────
if (process.env.NODE_ENV === 'development') {
    const tests = [
        ["lb (50lb)",   { salesUnit:'lb',    baseUnit:'lb',   packSize:50  }],
        ["lb (25lb)",   { salesUnit:'lb',    baseUnit:'lb',   packSize:25  }],
        ["case (25lb)", { salesUnit:'case',  baseUnit:'lb',   packSize:25  }],
        ["case (100)",  { salesUnit:'case',  baseUnit:'unit', packSize:100 }],
        ["bag (10kg)",  { salesUnit:'bag',   baseUnit:'kg',   packSize:10  }],
        ["lb",          { salesUnit:'lb',    baseUnit:'lb',   packSize:1   }],
        ["kg",          { salesUnit:'kg',    baseUnit:'kg',   packSize:1   }],
        ["bundle",      { normalizedPossible: false }],
        ["bag",         { normalizedPossible: false }],
        ["unit",        { salesUnit:'unit',  baseUnit:'unit', packSize:1   }],
    ];

    let allPassed = true;
    tests.forEach(([input, expected]) => {
        const result = parseUnitInfo(input);
        const pass = Object.entries(expected).every(([k, v]) => result[k] === v);
        if (!pass) {
            console.error(`[parseUnitInfo] FAIL "${input}":`, result, 'expected:', expected);
            allPassed = false;
        }
    });
    if (allPassed) {
        console.log('[parseUnitInfo] ✅ All self-tests passed');
    }
}
