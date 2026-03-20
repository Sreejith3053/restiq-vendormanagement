/**
 * verifyReset.mjs — Quick check that collections are empty after reset.
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';

const app = initializeApp({
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced",
});
const db = getFirestore(app, "restiq-vendormanagement");

const CHECK = [
    'vendors', 'marketplaceOrders', 'submittedOrders', 'vendorDispatches',
    'vendorDispatchRoutes', 'vendorInvoices', 'restaurantInvoices',
    'catalogItems', 'catalogReviewQueue', 'restaurants', 'issuesDisputes',
    'notifications', 'adminChangeLogs', 'systemExceptions', 'users',
    'suggestedOrderAIForcast_Model', 'correctionEntries',
    'login', 'platformSettings',
];

async function main() {
    console.log('\n═══ POST-RESET VERIFICATION ═══\n');
    for (const c of CHECK) {
        const snap = await getDocs(query(collection(db, c), limit(1))).catch(() => ({ size: 0 }));
        const status = snap.size === 0 ? '✅ EMPTY' : `⚠️  HAS DATA (${snap.size}+)`;
        const preserved = (c === 'login' || c === 'platformSettings');
        console.log(`  ${preserved ? '🔒' : '  '} ${c.padEnd(35)} ${status}`);
    }
    console.log('');
    process.exit(0);
}
main();
