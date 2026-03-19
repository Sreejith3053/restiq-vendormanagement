/**
 * cleanupLegacyFields.js — Phase 3 Group E (OPTIONAL, run AFTER validation)
 *
 * PURPOSE
 *   Remove legacy fields (`name`, `unit`, `price`, `packQuantity`, etc.) from
 *   vendor item documents ONLY when the v2 equivalents are already present.
 *
 * ⚠️  PREREQUISITES (all must pass before running --execute)
 *   1. backfillV2Fields.js --validate shows 100% v2-compliant.
 *   2. Dev + staging environments verified to work with v2 fields.
 *   3. Super-admin review of the pre-run validation report.
 *
 * USAGE (from project root, Node ≥ 18)
 *   # Dry-run — see what WOULD be removed, no writes
 *   node src/scripts/cleanupLegacyFields.js --dry-run
 *
 *   # Execute — remove legacy fields (safe: only removes if v2 exists)
 *   node src/scripts/cleanupLegacyFields.js --execute
 *
 *   # Scope to single vendor
 *   node src/scripts/cleanupLegacyFields.js --dry-run --vendor=<vendorId>
 *
 * SAFETY GUARDS
 *   - Requires --execute flag to write anything.
 *   - Skips any document that is still missing a v2 equivalent.
 *   - Uses FieldValue.delete() — never overwrites, always removes.
 *   - Commits in batches of 200.
 *   - Prints a diff of exactly which fields will be deleted per item.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

// ─── Config ───────────────────────────────────────────────────────────────────
const BATCH_SIZE = 200;
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const EXECUTE = ARGS.includes('--execute');
const VENDOR_FILTER = (ARGS.find(a => a.startsWith('--vendor=')) || '').replace('--vendor=', '') || null;

if (!DRY_RUN && !EXECUTE) {
    console.error('Usage: node cleanupLegacyFields.js [--dry-run | --execute] [--vendor=<id>]');
    process.exit(1);
}

/**
 * LEGACY_FIELD_GUARDS maps each legacy field to the v2 field that MUST exist
 * before the legacy one can be safely removed.
 */
const LEGACY_FIELD_GUARDS = {
    name:        'itemName',
    price:       'vendorPrice',
    unit:        'baseUnit',
    packQuantity: null,   // no v2 equivalent; only remove if manually confirmed safe
};

// Fields to actually clean up (edit this list to expand/restrict scope)
const FIELDS_TO_CLEANUP = ['name', 'price', 'unit'];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n========================================`);
    console.log(` Legacy Field Cleanup Script — Phase 3 Group E`);
    console.log(` Mode : ${DRY_RUN ? 'DRY-RUN (no writes)' : 'EXECUTE (writes enabled!)'}`);
    if (VENDOR_FILTER) console.log(` Vendor: ${VENDOR_FILTER}`);
    console.log(` Fields targeted: ${FIELDS_TO_CLEANUP.join(', ')}`);
    console.log(`========================================\n`);

    if (EXECUTE) {
        console.log('⚠️  EXECUTE mode active. Changes WILL be written to Firestore.');
        console.log('    Sleeping 5 seconds — press Ctrl+C to abort.\n');
        await new Promise(r => setTimeout(r, 5000));
    }

    const vendorsRef = db.collection('vendors');
    const vendorSnap = VENDOR_FILTER
        ? await vendorsRef.doc(VENDOR_FILTER).get().then(s => (s.exists ? [s] : []))
        : (await vendorsRef.get()).docs;

    if (vendorSnap.length === 0) {
        console.log('No vendors found. Exiting.');
        return;
    }

    const report = {
        vendorsScanned: 0,
        itemsScanned: 0,
        itemsSkipped: 0,       // v2 guard NOT satisfied — won't delete
        itemsCleaned: 0,
        fieldDeletedCounts: {},
    };
    FIELDS_TO_CLEANUP.forEach(f => { report.fieldDeletedCounts[f] = 0; });

    let batch = db.batch();
    let batchCount = 0;

    const flushBatch = async () => {
        if (batchCount > 0) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    };

    for (const vendorDoc of vendorSnap) {
        const vendorId = vendorDoc.id || vendorDoc;
        report.vendorsScanned++;

        const itemsSnap = await db.collection(`vendors/${vendorId}/items`).get();

        for (const itemDoc of itemsSnap.docs) {
            const data = itemDoc.data();
            report.itemsScanned++;

            const deletePatch = {};
            let skipped = false;

            for (const legacyField of FIELDS_TO_CLEANUP) {
                // Skip if legacy field doesn't exist on this doc
                if (data[legacyField] === undefined) continue;

                const guardField = LEGACY_FIELD_GUARDS[legacyField];

                if (guardField && (data[guardField] === undefined || data[guardField] === null || data[guardField] === '')) {
                    // v2 guard NOT satisfied — skip this doc entirely
                    console.warn(`[SKIP] vendor=${vendorId} item=${itemDoc.id}: "${legacyField}" kept because "${guardField}" is missing`);
                    skipped = true;
                    break;
                }

                deletePatch[legacyField] = FieldValue.delete();
                report.fieldDeletedCounts[legacyField]++;
            }

            if (skipped) {
                report.itemsSkipped++;
                continue;
            }

            if (Object.keys(deletePatch).length === 0) continue;

            report.itemsCleaned++;

            if (DRY_RUN) {
                console.log(`[DRY-RUN] vendor=${vendorId} item=${itemDoc.id} would delete: ${Object.keys(deletePatch).join(', ')}`);
            } else {
                batch.update(itemDoc.ref, deletePatch);
                batchCount++;

                if (batchCount >= BATCH_SIZE) {
                    await flushBatch();
                    console.log(`  Committed batch of ${BATCH_SIZE} deletes…`);
                }
            }
        }
    }

    if (EXECUTE) await flushBatch();

    // ─── Summary ──
    console.log(`\n========================================`);
    console.log(` CLEANUP SUMMARY`);
    console.log(`========================================`);
    console.log(`  Vendors scanned  : ${report.vendorsScanned}`);
    console.log(`  Items scanned    : ${report.itemsScanned}`);
    console.log(`  Items skipped    : ${report.itemsSkipped} (v2 guard missing)`);
    console.log(`  Items cleaned    : ${report.itemsCleaned}`);
    console.log(`\n  Fields removed (counts apply to ${DRY_RUN ? 'would-be' : 'actual'} deletes):`);
    for (const [field, count] of Object.entries(report.fieldDeletedCounts)) {
        console.log(`    ${field.padEnd(22)}: ${count}`);
    }
    console.log(`========================================\n`);

    if (DRY_RUN && report.itemsSkipped > 0) {
        console.log(`⚠️  ${report.itemsSkipped} items were skipped. Run backfillV2Fields.js --backfill first.`);
    }
    if (!DRY_RUN && report.itemsCleaned > 0) {
        console.log(`✅ Legacy field cleanup complete. ${report.itemsCleaned} items updated.`);
    }
    if (report.itemsCleaned === 0) {
        console.log('✅ Nothing to clean up — all targeted legacy fields are already absent.');
    }
}

main().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
