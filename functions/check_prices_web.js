const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, writeBatch } = require("firebase/firestore");

const firebaseConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "restiq-vendormanagement");

const ITEM_ALIAS_MAP = {
    'Coriander': 'Coriander Leaves',
    'Mint': 'Mint Leaves',
    'Onion Cooking': 'Onion - Cooking',
    'Onion Cooking 50lbs': 'Onion - Cooking',
    'Onion - Red': 'Onion - Red',
    'Onion Red 25lbs': 'Onion - Red',
    'Carrot 50lbs': 'Carrot'
};

const prices = {
    "Ash Guard": 1.20, "Beets": 1.50, "Cabbage": 24.99, "Capsicum Green": 1.80,
    "Capsicum Red": 2.50, "Capsicum Yellow": 2.50, "Carrot": 18.00, "Cauliflower": 28.00,
    "Celery": 3.50, "Coriander Leaves": 1.25, "Curry Leaves": 12.00, "French Beans": 4.00,
    "Ginger": 45.00, "Green Onion": 1.50, "Leeks": 2.00, "Lemon": 35.00,
    "Lime": 0.50, "Long Beans": 3.00, "Mint Leaves": 1.50, "Okra": 3.00,
    "Onion - Cooking": 19.00, "Onion - Red": 14.00, "Peeled Garlic": 42.00,
    "Pepper Mix": 2.50, "Plantain Green": 0.60, "Potatoes": 22.00, "Thai Chilli": 55.00
};

async function checkData() {
    console.log("Locating ON Thyme...");
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

    itemsSnap.docs.forEach(d => {
        const rawName = d.data().name;
        const name = rawName ? ITEM_ALIAS_MAP[rawName.trim()] || rawName.trim() : null;

        if (name && prices[name] !== undefined) {
            batch.update(d.ref, { price: prices[name] });
            count++;
            console.log(`Writing $${prices[name]} to ${name}...`);
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`SUCCESS! Wrote prices to ${count} items.`);
    } else {
        console.log("WARNING: Zero items matched.");
    }
    process.exit(0);
}

checkData();
