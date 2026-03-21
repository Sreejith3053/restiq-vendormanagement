/**
 * Delete all items from vendor 9jbt0Q51EuQ1kFDD42Iq
 * Run with: node scripts/deleteVendorItems.js
 */
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced",
    measurementId: "G-MMSWW29CM3",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "restiq-vendormanagement");

const VENDOR_ID = '9jbt0Q51EuQ1kFDD42Iq';

async function deleteAllItems() {
    const itemsRef = collection(db, `vendors/${VENDOR_ID}/items`);
    const snapshot = await getDocs(itemsRef);

    console.log(`Found ${snapshot.docs.length} items for vendor ${VENDOR_ID}`);

    if (snapshot.docs.length === 0) {
        console.log('No items to delete.');
        process.exit(0);
    }

    let deleted = 0;
    for (const d of snapshot.docs) {
        await deleteDoc(doc(db, `vendors/${VENDOR_ID}/items`, d.id));
        deleted++;
        if (deleted % 10 === 0) console.log(`  Deleted ${deleted}/${snapshot.docs.length}...`);
    }

    console.log(`Done! Deleted ${deleted} items from vendor ${VENDOR_ID}`);
    process.exit(0);
}

deleteAllItems().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
