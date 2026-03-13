/**
 * cleanup_old_collections.js
 * 
 * One-time script to delete unused Firestore collections from the vendor database.
 * Run with: node cleanup_old_collections.js
 * 
 * Collections deleted:
 *   1. forecastCorrections      → replaced by forecast/corrections/entries
 *   2. weeklyRestaurantForecasts → replaced by forecast/weekly/entries
 *   3. restaurantItemForecasts   → old forecastEngine.js artifact
 *   4. aggregateItemForecasts    → old forecastEngine.js artifact
 *   5. vendorPlanningForecasts   → old forecastEngine.js artifact
 *   6. forecastAccuracyLogs      → old forecastAccuracy.js artifact
 *   7. forecastConfig            → old engine config
 *   8. vegetablePurchaseHistory  → one-time seed script data
 */

const admin = require('firebase-admin');

// Uses default credentials from `firebase login` or GOOGLE_APPLICATION_CREDENTIALS
admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'restiq-vendormanagement',
});

const db = admin.firestore();

const COLLECTIONS_TO_DELETE = [
    'forecastCorrections',
    'weeklyRestaurantForecasts',
    'restaurantItemForecasts',
    'aggregateItemForecasts',
    'vendorPlanningForecasts',
    'forecastAccuracyLogs',
    'forecastConfig',
    'vegetablePurchaseHistory',
];

async function deleteCollection(collectionName) {
    const collectionRef = db.collection(collectionName);
    const snapshot = await collectionRef.limit(500).get();

    if (snapshot.empty) {
        console.log(`  ✅ ${collectionName} — already empty or does not exist`);
        return 0;
    }

    let totalDeleted = 0;
    let batch = db.batch();
    let batchCount = 0;

    // Paginate through all docs
    let query = collectionRef.limit(500);
    let page = await query.get();

    while (!page.empty) {
        for (const doc of page.docs) {
            batch.delete(doc.ref);
            batchCount++;
            totalDeleted++;

            if (batchCount >= 500) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }

        // Get next page
        const lastDoc = page.docs[page.docs.length - 1];
        page = await collectionRef.startAfter(lastDoc).limit(500).get();
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    console.log(`  🗑️  ${collectionName} — deleted ${totalDeleted} documents`);
    return totalDeleted;
}

async function main() {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  Vendor DB — Firestore Collection Cleanup');
    console.log('═══════════════════════════════════════════════════\n');

    let grandTotal = 0;

    for (const name of COLLECTIONS_TO_DELETE) {
        try {
            const count = await deleteCollection(name);
            grandTotal += count;
        } catch (err) {
            console.error(`  ❌ ${name} — ERROR: ${err.message}`);
        }
    }

    console.log(`\n✅ Done! Deleted ${grandTotal} total documents across ${COLLECTIONS_TO_DELETE.length} collections.\n`);
    process.exit(0);
}

main();
