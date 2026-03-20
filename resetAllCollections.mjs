/**
 * resetAllCollections.mjs
 * 
 * Deletes ALL Firestore collections in restiq-vendormanagement EXCEPT `login`.
 * Uses the Firebase Web SDK (already in node_modules).
 * 
 * Usage:  node resetAllCollections.mjs
 */

import { initializeApp } from 'firebase/app';
import {
    getFirestore, collection, getDocs, writeBatch, doc,
    query, limit, deleteDoc,
} from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "restiq-vendormanagement");

const BATCH_SIZE = 400;

// ── Every collection to delete (all except `login` and `platformSettings`) ──
const COLLECTIONS_TO_DELETE = [
    'marketplaceOrders',
    'submittedOrders',
    'vendorDispatches',
    'vendorDispatchRoutes',
    'vendorInvoices',
    'restaurantInvoices',
    'RestaurantPaymentHistory',
    'invoiceAdjustments',
    'payouts',
    'reconciliationReports',
    'financeDisputes',
    'issuesDisputes',
    'catalogItems',
    'catalogReviewQueue',
    'catalogItemMappingReview',
    'pendingReviews',
    'unmappedItems',
    'vendorComparisonSnapshots',
    'vendorComparisonReviewQueue',
    'restaurants',
    'masterRestaurants',
    'notifications',
    'systemAlerts',
    'systemLogs',
    'systemMetrics',
    'systemExceptions',
    'adminChangeLogs',
    'migrationLogs',
    'allocationSnapshots',
    'forecastSnapshots',
    'capacitySnapshots',
    'vendorScores',
    'suggestedOrderAIForcast_Model',
    'correctionEntries',
    'festivalCalendar',
    'importHistory',
    'importBatches',
    'users',
];

// Vendor subcollection paths
const VENDOR_ITEM_SUBS = ['history', 'auditLog'];
const VENDOR_BATCH_SUBS = ['rows'];

async function deleteCollection(collPath) {
    let deleted = 0;
    while (true) {
        const q = query(collection(db, collPath), limit(BATCH_SIZE));
        const snap = await getDocs(q);
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < BATCH_SIZE) break;
    }
    return deleted;
}

async function deleteSubcoll(parentRef, subName) {
    let deleted = 0;
    while (true) {
        const q = query(collection(parentRef, subName), limit(BATCH_SIZE));
        const snap = await getDocs(q);
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < BATCH_SIZE) break;
    }
    return deleted;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  FIRESTORE RESET — restiq-vendormanagement');
    console.log('  Deleting ALL collections except: login, platformSettings');
    console.log('═══════════════════════════════════════════════════════\n');

    let grandTotal = 0;

    // ── 1. Delete vendor subcollections first, then vendor docs ──
    console.log('── Phase 1: Vendor deep delete ──');
    const vendorSnap = await getDocs(collection(db, 'vendors')).catch(() => ({ docs: [] }));
    console.log(`   Found ${vendorSnap.docs?.length || 0} vendor docs`);

    let vendorSubTotal = 0;
    for (const vDoc of (vendorSnap.docs || [])) {
        const vName = vDoc.data().name || vDoc.id;
        let vSubs = 0;

        // items → item sub-subs → delete items
        const itemSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`)).catch(() => ({ docs: [] }));
        for (const iDoc of (itemSnap.docs || [])) {
            for (const sub of VENDOR_ITEM_SUBS) {
                const n = await deleteSubcoll(iDoc.ref, sub).catch(() => 0);
                vSubs += n;
            }
            await deleteDoc(iDoc.ref).catch(() => {});
            vSubs++;
        }

        // importBatches → batch rows → delete batches
        const batchSnap = await getDocs(collection(db, `vendors/${vDoc.id}/importBatches`)).catch(() => ({ docs: [] }));
        for (const bDoc of (batchSnap.docs || [])) {
            for (const sub of VENDOR_BATCH_SUBS) {
                const n = await deleteSubcoll(bDoc.ref, sub).catch(() => 0);
                vSubs += n;
            }
            await deleteDoc(bDoc.ref).catch(() => {});
            vSubs++;
        }

        // vendor-level auditLog
        const auditN = await deleteSubcoll(vDoc.ref, 'auditLog').catch(() => 0);
        vSubs += auditN;

        // Delete vendor doc itself
        await deleteDoc(vDoc.ref).catch(() => {});
        vSubs++;

        vendorSubTotal += vSubs;
        console.log(`   🗑️ Vendor "${vName}" — ${vSubs} docs deleted`);
    }

    grandTotal += vendorSubTotal;
    console.log(`   ✅ Vendor total: ${vendorSubTotal} docs\n`);

    // ── 2. Delete top-level collections ──
    console.log('── Phase 2: Top-level collections ──');
    for (const collName of COLLECTIONS_TO_DELETE) {
        const n = await deleteCollection(collName).catch(() => 0);
        grandTotal += n;
        if (n > 0) {
            console.log(`   🗑️ ${collName} — ${n} deleted`);
        } else {
            console.log(`   ⬜ ${collName} — empty`);
        }
    }

    // ── 3. Summary ──
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  ✅ RESET COMPLETE — ${grandTotal} total documents deleted`);
    console.log('  🔒 PRESERVED: login, platformSettings');
    console.log('═══════════════════════════════════════════════════════');

    process.exit(0);
}

main().catch(err => {
    console.error('❌ FATAL ERROR:', err.message);
    process.exit(1);
});
