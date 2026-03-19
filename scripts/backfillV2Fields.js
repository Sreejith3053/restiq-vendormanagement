/**
 * backfillV2Fields.js
 *
 * One-time safe batch script to add v2 canonical fields to existing Firestore documents.
 *
 * What it does:
 *   - For each vendor item: adds baseUnit, orderUnit, normalizedStatus (if missing)
 *   - For each catalog item: adds canonicalName, canonicalNameNormalized (if missing)
 *
 * Rules:
 *   - NEVER overwrites a field that already has a correct value
 *   - Writes in batches of 20 using Firestore WriteBatch
 *   - Safe to run multiple times (idempotent)
 *
 * Usage:
 *   node scripts/backfillV2Fields.js
 */

const admin = require('firebase-admin');
const path = require('path');

// ── Firebase init ─────────────────────────────────────────────────────────────
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '..', 'service-account.json');

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

// ── Normalize helpers (mirrors client-side logic) ─────────────────────────────

function normalizeStr(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function normalizeText(s) {
    return (s || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Batch writer utility ──────────────────────────────────────────────────────

async function commitBatch(writes) {
    if (writes.length === 0) return 0;
    const batch = db.batch();
    writes.forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
    return writes.length;
}

async function flushWrites(pending) {
    const CHUNK = 20;
    let total = 0;
    for (let i = 0; i < pending.length; i += CHUNK) {
        total += await commitBatch(pending.slice(i, i + CHUNK));
    }
    return total;
}

// ── 1. Backfill vendor items ──────────────────────────────────────────────────

async function backfillVendorItems() {
    console.log('\n[1] Backfilling vendor items…');
    const vendorsSnap = await db.collection('vendors').get();
    let itemsChecked = 0;
    let itemsPatched = 0;

    for (const vendorDoc of vendorsSnap.docs) {
        const vendorId = vendorDoc.id;
        const itemsSnap = await db.collection('vendors').doc(vendorId).collection('items').get();
        const pending = [];

        for (const itemDoc of itemsSnap.docs) {
            itemsChecked++;
            const data = itemDoc.data();
            const patch = {};

            // baseUnit: derive from existing unit if missing
            if (!data.baseUnit && data.unit) {
                patch.baseUnit = normalizeStr(data.unit) || data.unit;
            }

            // orderUnit: same as unit if missing
            if (!data.orderUnit && (data.unit || data.baseUnit)) {
                patch.orderUnit = data.unit || data.baseUnit;
            }

            // normalizedStatus: lowercase of status if missing
            if (!data.normalizedStatus && data.status) {
                patch.normalizedStatus = (data.status || '').toLowerCase();
            }

            // itemName: copy from name if missing (v2 canonical field)
            if (!data.itemName && data.name) {
                patch.itemName = data.name;
            }

            if (Object.keys(patch).length > 0) {
                patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                pending.push({ ref: itemDoc.ref, data: patch });
            }
        }

        if (pending.length > 0) {
            const written = await flushWrites(pending);
            itemsPatched += written;
            console.log(`  Vendor ${vendorId}: patched ${written} of ${itemsSnap.size} items`);
        }
    }

    console.log(`  ✓ Vendor items: checked ${itemsChecked}, patched ${itemsPatched}`);
    return { itemsChecked, itemsPatched };
}

// ── 2. Backfill catalog items ─────────────────────────────────────────────────

async function backfillCatalogItems() {
    console.log('\n[2] Backfilling catalog items…');
    const snap = await db.collection('catalogItems').get();
    const pending = [];

    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const patch = {};

        // canonicalName: derive from itemName if missing
        if (!data.canonicalName && (data.itemName || data.name)) {
            patch.canonicalName = data.itemName || data.name;
        }

        // canonicalNameNormalized: normalize canonicalName if missing
        const sourceName = data.canonicalName || patch.canonicalName || data.itemName || data.name || '';
        if (!data.canonicalNameNormalized && sourceName) {
            patch.canonicalNameNormalized = normalizeText(sourceName);
        }

        // itemNameNormalized: normalize itemName if missing
        if (!data.itemNameNormalized && (data.itemName || data.name)) {
            patch.itemNameNormalized = normalizeText(data.itemName || data.name);
        }

        if (Object.keys(patch).length > 0) {
            patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            pending.push({ ref: docSnap.ref, data: patch });
        }
    }

    const patched = await flushWrites(pending);
    console.log(`  ✓ Catalog items: checked ${snap.size}, patched ${patched}`);
    return { checked: snap.size, patched };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('=== RestIQ v2 Field Backfill Script ===');
    console.log('Strategy: ADD only — never overwrite existing values\n');

    const startTime = Date.now();
    let exitCode = 0;

    try {
        const vendorResults = await backfillVendorItems();
        const catalogResults = await backfillCatalogItems();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('\n=== Backfill Complete ===');
        console.log(`Vendor items  — checked: ${vendorResults.itemsChecked}, patched: ${vendorResults.itemsPatched}`);
        console.log(`Catalog items — checked: ${catalogResults.checked}, patched: ${catalogResults.patched}`);
        console.log(`Total time: ${elapsed}s`);
    } catch (err) {
        console.error('\n[ERROR] Backfill failed:', err);
        exitCode = 1;
    } finally {
        await admin.app().delete();
        process.exit(exitCode);
    }
}

main();
