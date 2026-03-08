const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Might exist

admin.initializeApp();
const db = admin.firestore();

async function run() {
    try {
        const vendorSnap = await db.collection('vendors').get();
        let targetVendorId = null;
        vendorSnap.docs.forEach(doc => {
            const vName = doc.data().name || '';
            if (vName.toLowerCase().includes('thyme')) {
                targetVendorId = doc.id;
            }
        });

        console.log("Vendor ID:", targetVendorId);

        if (targetVendorId) {
            const q = db.collection(`vendors/${targetVendorId}/items`);
            const catalogSnap = await q.get();
            let count = 0;
            let activeCount = 0;
            catalogSnap.docs.forEach(doc => {
                count++;
                const data = doc.data();
                const isActive = !data.disabled && !data.outOfStock && data.status !== 'in-review';
                if (isActive && data.name) {
                    activeCount++;
                    console.log(`Active Item: ${data.name}`);
                }
            });
            console.log(`Total vendor docs: ${count}, Active items tracked: ${activeCount}`);
        }
    } catch (e) {
        console.error(e);
    }
}
run();
