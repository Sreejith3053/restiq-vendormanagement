const admin = require('firebase-admin');

// Ensure you have a service account key or ADC configured for this project
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const TABS = {
    SUCCESS: '\x1b[32m',
    ERROR: '\x1b[31m',
    RESET: '\x1b[0m'
};

async function seedData() {
    try {
        console.log('Fetching existing vendors...');
        const vendorsSnap = await db.collection('vendors').limit(2).get();
        if (vendorsSnap.empty) {
            console.log(TABS.ERROR + 'No vendors found! Please add a vendor first.' + TABS.RESET);
            process.exit(1);
        }

        const vendors = vendorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const vendor1 = vendors[0];
        const vendor2 = vendors[1] || vendors[0];

        // Seed Orders for Today
        console.log('Seeding dummy orders...');
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);

        const orders = [
            {
                vendorId: vendor1.id,
                status: 'FULFILLED',
                total: 100,
                grandTotalAfterTax: 110, // Let's say 10% tax
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                orderDate: now.toISOString()
            },
            {
                vendorId: vendor2.id,
                status: 'NEW',
                total: 50,
                grandTotalAfterTax: 55,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                orderDate: now.toISOString()
            },
            {
                vendorId: vendor1.id,
                status: 'CANCELLED',
                total: 200,
                grandTotalAfterTax: 220,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                orderDate: now.toISOString()
            },
            {
                vendorId: vendor2.id,
                status: 'FULFILLED',
                total: 300,
                grandTotalAfterTax: 330,
                createdAt: admin.firestore.Timestamp.fromDate(yesterday),
                orderDate: yesterday.toISOString()
            }
        ];

        for (const order of orders) {
            await db.collection('marketplaceOrders').add(order);
        }

        console.log('Seeding dummy vendor invoices...');

        // Let's assume vendor flat percent is 10 for v1, 15 for v2
        const invoices = [
            {
                vendorId: vendor1.id,
                grossVendorAmount: 100,
                commissionPercent: 10,
                commissionAmount: 10,
                netVendorPayable: 90,
                paymentStatus: 'PENDING',
                commissionModel: 'VENDOR_FLAT_PERCENT',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                invoiceDate: now.toISOString()
            },
            {
                vendorId: vendor2.id,
                grossVendorAmount: 300,
                commissionPercent: 15,
                commissionAmount: 45,
                netVendorPayable: 255,
                paymentStatus: 'PAID', // Simulate a paid old invoice
                commissionModel: 'VENDOR_FLAT_PERCENT',
                createdAt: admin.firestore.Timestamp.fromDate(yesterday),
                invoiceDate: yesterday.toISOString()
            }
        ];

        for (const inv of invoices) {
            await db.collection('vendorInvoices').add(inv);
        }

        console.log(TABS.SUCCESS + 'Seeding complete!' + TABS.RESET);
        process.exit(0);
    } catch (e) {
        console.error(TABS.ERROR + 'Seeding failed: ' + e.message + TABS.RESET);
        process.exit(1);
    }
}

seedData();
