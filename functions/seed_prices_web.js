const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, writeBatch, doc } = require("firebase/firestore");
const fs = require('fs');

const firebaseConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
    console.log("Starting Web SDK Seeder...");
    const catalogCsv = fs.readFileSync('C:/Users/oruma/Documents/testdata Veggies/vendor_item_catalog.csv', 'utf8');
    const lines = catalogCsv.split('\n').filter(l => l.trim() !== '');
    const headers = lines[0].trim().split(',').map(h => h.trim());
    const catalogMap = {};
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = line.split(',');
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] ? values[idx].trim() : '';
        });
        if (row.item_name) catalogMap[row.item_name.trim()] = Number(row.price) || 0;
    }

    const vendorSnap = await getDocs(collection(db, 'vendors'));
    let onThymeId = null;
    vendorSnap.docs.forEach(d => {
        if ((d.data().name || d.data().businessName || '').toLowerCase().includes('thyme')) {
            onThymeId = d.id;
        }
    });

    if (!onThymeId) return console.log("ON Thyme not found");

    const itemsSnap = await getDocs(collection(db, `vendors/${onThymeId}/items`));
    const batch = writeBatch(db);
    let count = 0;

    itemsSnap.docs.forEach(docSnap => {
        const name = docSnap.data().name;
        if (name && catalogMap[name.trim()] !== undefined) {
            batch.update(docSnap.ref, { price: catalogMap[name.trim()] });
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully updated ${count} items using Web SDK!`);
    } else {
        console.log("No items matched.");
    }
    process.exit(0);
}
run();
