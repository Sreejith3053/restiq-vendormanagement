const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Might exist

admin.initializeApp();
// if it fails we can just use default initialization
const db = admin.firestore();

async function run() {
    try {
        const snap = await db.collection('vendors').get();
        snap.docs.forEach(d => {
            const data = d.data();
            if (data.name && data.name.toLowerCase().includes('thyme')) {
                console.log(`FOUND VENDOR: id=${d.id}, name="${data.name}"`);
                db.collection(`vendors/${d.id}/items`).get().then(itemSnap => {
                    console.log(`Found ${itemSnap.size} items for this vendor.`);
                    if (itemSnap.size > 0) {
                        console.log("Sample Item:", itemSnap.docs[0].data());
                    }
                });
            }
        });
    } catch (e) {
        console.error(e);
    }
}
run();
