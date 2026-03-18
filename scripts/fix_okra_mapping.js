/**
 * fix_okra_mapping.js
 * One-time script to clear incorrect catalogItemId from Okra vendor items.
 * Run from the project root: node scripts/fix_okra_mapping.js
 *
 * This script:
 * 1. Queries all vendor items collections for items named "Okra"
 * 2. Clears the catalogItemId that was incorrectly set to the Cooking Onion catalog item
 * 3. Resets mappingStatus to 'unmapped'
 * 4. Logs any catalogReviewQueue items for Okra and resets them to 'pending'
 */

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function fixOkraMapping() {
    console.log('=== Fixing Okra → Cooking Onion incorrect mapping ===\n');

    let fixedCount = 0;

    // 1. Find all vendors
    const vendorsSnap = await db.collection('vendors').get();
    console.log(`Checking ${vendorsSnap.size} vendors...`);

    for (const vendorDoc of vendorsSnap.docs) {
        const vendorId = vendorDoc.id;

        // 2. Find items named "Okra" in this vendor's catalog
        const itemsSnap = await db
            .collection('vendors').doc(vendorId).collection('items')
            .get();

        for (const itemDoc of itemsSnap.docs) {
            const data = itemDoc.data();
            const itemName = (data.name || data.itemName || '').toLowerCase().trim();

            if (itemName === 'okra' && data.catalogItemId) {
                console.log(`\nFound Okra item with mapping:`);
                console.log(`  Vendor: ${vendorId}`);
                console.log(`  Item ID: ${itemDoc.id}`);
                console.log(`  Current catalogItemId: ${data.catalogItemId}`);
                console.log(`  Current mappingStatus: ${data.mappingStatus}`);

                // Clear the incorrect mapping
                await db
                    .collection('vendors').doc(vendorId)
                    .collection('items').doc(itemDoc.id)
                    .update({
                        catalogItemId: admin.firestore.FieldValue.delete(),
                        mappingStatus: 'unmapped',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedBy: 'system_fix_script',
                    });

                console.log(`  ✅ Cleared catalogItemId, set mappingStatus = unmapped`);
                fixedCount++;
            }
        }
    }

    // 3. Reset any review queue items for Okra that were marked as approved_map_to_catalog_item
    const queueSnap = await db.collection('catalogReviewQueue')
        .where('status', '==', 'approved')
        .where('resolutionAction', '==', 'mapped_to_catalog_item')
        .get();

    for (const qDoc of queueSnap.docs) {
        const data = qDoc.data();
        const proposed = data.proposedData || {};
        const itemName = (proposed.itemName || '').toLowerCase().trim();

        if (itemName === 'okra') {
            console.log(`\nResetting review queue item: ${qDoc.id}`);
            await db.collection('catalogReviewQueue').doc(qDoc.id).update({
                status: 'pending',
                resolutionAction: null,
                resolutionNotes: 'Reverted by admin: incorrect mapping to Cooking Onion',
                reviewedAt: null,
                reviewedBy: null,
            });

            // Write history
            await db.collection('catalogReviewQueue').doc(qDoc.id)
                .collection('history').add({
                    action: 'reverted_incorrect_mapping',
                    actionBy: 'system_fix_script',
                    actionAt: admin.firestore.FieldValue.serverTimestamp(),
                    notes: 'Okra was incorrectly mapped to Cooking Onion catalog item. Reverted to pending.',
                    oldStatus: 'approved',
                    newStatus: 'pending',
                });
            console.log(`  ✅ Queue item reset to pending`);
        }
    }

    console.log(`\n=== Done. Fixed ${fixedCount} vendor item(s). ===`);
    process.exit(0);
}

fixOkraMapping().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
