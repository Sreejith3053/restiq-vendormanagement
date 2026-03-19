/**
 * backfillV2Fields.js — Phase 3 Group D
 *
 * PURPOSE
 *   Scan every vendor item document and:
 *   1. In --validate mode : report how many docs are missing each v2 field (dry-run, no writes).
 *   2. In --backfill mode : write the missing v2 fields derived from legacy values (safe, additive only).
 *
 * USAGE (from project root, Node ≥ 18)
 *   # Validate only (no writes)
 *   node src/scripts/backfillV2Fields.js --validate
 *
 *   # Backfill (writes only missing fields)
 *   node src/scripts/backfillV2Fields.js --backfill
 *
 *   # Validate a specific vendor
 *   node src/scripts/backfillV2Fields.js --validate --vendor=<vendorId>
 *
 * SAFETY
 *   - Never deletes fields.
 *   - Never overwrites fields that already have a value.
 *   - Commits in small batches (BATCH_SIZE = 200) to respect Firestore limits.
 *   - Prints a summary report at the end.
 */

// ─── Firebase Admin init (uses application-default credentials) ───────────────
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// ─── Config ───────────────────────────────────────────────────────────────────
const BATCH_SIZE = 200;
const ARGS = process.argv.slice(2);
const MODE_VALIDATE = ARGS.includes('--validate');
const MODE_BACKFILL = ARGS.includes('--backfill');
const VENDOR_FILTER = (ARGS.find(a => a.startsWith('--vendor=')) || '').replace('--vendor=', '') || null;

if (!MODE_VALIDATE && !MODE_BACKFILL) {
    console.error('Usage: node backfillV2Fields.js [--validate | --backfill] [--vendor=<id>]');
    process.exit(1);
}

// ─── Normalizers (mirrors those in firestoreHelpers.js / importFirestore.js) ──
function normalizeString(str) {
    if (!str) return '';
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUnit(unit) {
    if (!unit) return '';
    const map = { kilogram: 'kg', kilograms: 'kg', litre: 'L', litres: 'L', liter: 'L', liters: 'L', pound: 'lb', pounds: 'lb', gram: 'g', grams: 'g', milliliter: 'mL', millilitre: 'mL', milliliters: 'mL', ounce: 'oz', ounces: 'oz' };
    const lower = unit.trim().toLowerCase();
    return map[lower] || lower;
}

function normalizePackSize(packSize) {
    if (!packSize) return '';
    return packSize.toString().trim().toLowerCase();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n========================================`);
    console.log(` v2 Backfill/Validation Script`);
    console.log(` Mode: ${MODE_VALIDATE ? 'VALIDATE (dry-run)' : 'BACKFILL (writes enabled)'}`);
    if (VENDOR_FILTER) console.log(` Vendor filter: ${VENDOR_FILTER}`);
    console.log(`========================================\n`);

    const vendorsRef = db.collection('vendors');
    const vendorSnap = VENDOR_FILTER
        ? await vendorsRef.doc(VENDOR_FILTER).get().then(s => (s.exists ? [s] : []))
        : (await vendorsRef.get()).docs;

    if (vendorSnap.length === 0) {
        console.log('No vendors found. Exiting.');
        return;
    }

    // Summary counters
    const report = {
        vendorsScanned: 0,
        itemsScanned: 0,
        itemsMissingAnyV2Field: 0,
        itemsBackfilled: 0,
        fieldMissingCounts: {
            itemName: 0,
            itemNameNormalized: 0,
            vendorPrice: 0,
            baseUnit: 0,
            orderUnit: 0,
            packSizeNormalized: 0,
            normalizedStatus: 0,
        },
    };

    let writeBatch = db.batch();
    let batchCount = 0;

    const flushBatch = async () => {
        if (batchCount > 0) {
            await writeBatch.commit();
            writeBatch = db.batch();
            batchCount = 0;
        }
    };

    for (const vendorDoc of vendorSnap) {
        const vendorId = vendorDoc.id || vendorDoc;
        report.vendorsScanned++;

        const itemsRef = db.collection(`vendors/${vendorId}/items`);
        const itemsSnap = await itemsRef.get();

        for (const itemDoc of itemsSnap.docs) {
            const data = itemDoc.data();
            report.itemsScanned++;

            // ─── Determine what is missing ──
            const patch = {};

            // itemName
            if (!data.itemName && data.name) {
                patch.itemName = data.name;
                report.fieldMissingCounts.itemName++;
            }

            // itemNameNormalized
            const effectiveItemName = data.itemName || data.name || '';
            if (!data.itemNameNormalized && effectiveItemName) {
                patch.itemNameNormalized = normalizeString(effectiveItemName);
                report.fieldMissingCounts.itemNameNormalized++;
            }

            // vendorPrice
            if (data.vendorPrice === undefined && data.price !== undefined) {
                patch.vendorPrice = Number(data.price) || 0;
                report.fieldMissingCounts.vendorPrice++;
            }

            // baseUnit
            const effectiveUnit = data.unit || '';
            if (!data.baseUnit && effectiveUnit) {
                patch.baseUnit = normalizeUnit(effectiveUnit) || effectiveUnit;
                report.fieldMissingCounts.baseUnit++;
            }

            // orderUnit
            if (!data.orderUnit && effectiveUnit) {
                patch.orderUnit = effectiveUnit;
                report.fieldMissingCounts.orderUnit++;
            }

            // packSizeNormalized
            if (!data.packSizeNormalized && data.packSize) {
                patch.packSizeNormalized = normalizePackSize(data.packSize);
                report.fieldMissingCounts.packSizeNormalized++;
            }

            // normalizedStatus
            const rawStatus = data.status || 'active';
            if (!data.normalizedStatus) {
                patch.normalizedStatus = rawStatus.toLowerCase();
                report.fieldMissingCounts.normalizedStatus++;
            }

            if (Object.keys(patch).length === 0) continue;

            report.itemsMissingAnyV2Field++;

            if (MODE_VALIDATE) {
                // Dry-run: just report
                console.log(`[VALIDATE] vendor=${vendorId} item=${itemDoc.id} missing: ${Object.keys(patch).join(', ')}`);
            } else {
                // Backfill: write only missing fields
                writeBatch.update(itemDoc.ref, patch);
                batchCount++;
                report.itemsBackfilled++;

                if (batchCount >= BATCH_SIZE) {
                    await flushBatch();
                    console.log(`  Committed batch of ${BATCH_SIZE} updates…`);
                }
            }
        }
    }

    // Final flush
    if (MODE_BACKFILL) await flushBatch();

    // ─── Summary Report ──
    console.log(`\n========================================`);
    console.log(` SUMMARY REPORT`);
    console.log(`========================================`);
    console.log(`  Vendors scanned    : ${report.vendorsScanned}`);
    console.log(`  Items scanned      : ${report.itemsScanned}`);
    console.log(`  Items with gaps    : ${report.itemsMissingAnyV2Field}`);
    if (MODE_BACKFILL) {
        console.log(`  Items backfilled   : ${report.itemsBackfilled}`);
    }
    console.log(`\n  Missing field breakdown:`);
    for (const [field, count] of Object.entries(report.fieldMissingCounts)) {
        if (count > 0) console.log(`    ${field.padEnd(22)}: ${count}`);
    }
    console.log(`\n  Coverage: ${((report.itemsScanned - report.itemsMissingAnyV2Field) / Math.max(report.itemsScanned, 1) * 100).toFixed(1)}% of items fully v2-compliant`);
    console.log(`========================================\n`);

    if (report.itemsMissingAnyV2Field === 0) {
        console.log('✅ All items are v2-compliant. No backfill needed.');
    } else if (MODE_VALIDATE) {
        console.log(`⚠️  ${report.itemsMissingAnyV2Field} items need backfill. Run with --backfill to apply.`);
    } else {
        console.log(`✅ Backfill complete. ${report.itemsBackfilled} items updated.`);
    }
}

main().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
