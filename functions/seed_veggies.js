const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const rmsServiceAccount = {
    type: "service_account",
    project_id: "orumarmsprod",
    private_key_id: "8e8360ad7717da54dd456125378a9feb1ddf5854",
    private_key: process.env.RMS_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDfUKGmKzOHXrJr\nYAhkMVgdjGkX86Zt8WKFWnvxinJuMWLFS8aHhRfHTIoBI8jckbofQGtHCaCy6mPm\ntMZ+CisOpzso8yTBkLLDRcrXaAQYR42zBu4daKJ5wNFBJqczcPRuQ+xM0KE4YWCq\nIxyuZ1l/m7qygODKTqdkq7jrvoxwRWgAINCeMdaf7P1nStU4CzqlA4Fd1XEO7k3a\nAsKI6KdXAvhREyyYqPBfLIKoG9bAyzWpt26trOMBRtJIeLAXSqOrqvIIlfTt6IKc\nRnmgIadhxsyIMZ8k8DfyuqDY0fujog4fVzQzRVJvxmBp0Zinw+2yKat+lGvT8zUO\npkoeskCpAgMBAAECggEACQo9kPl8u4Uk2d3oWQ36UC/n7TVKznaQE2/nRo7hNP7A\nzdXUcpX7sXCywXsOXYd0rmEwNo74N2Xvp144DtAgkBZK+cxl94QBCJChtniaedUj\nslScfQpIUX9xuR50dEulSXVscmubqymd/SUwuwqp/9VxCFrZPrdSZWviL4DmNIE3\naPUYeEanzs/fhpWlN1cNfRpHZBqvRzdowIaCeHLKUBJAblaaadDot5Zwcj4YW95E\n/yfD1zrcUYz58huXk01SaLpyonu+jOhR/Uf4ynnCYAGkyQcRlOEVT4W4aj+WVepH\nEQSzaufyZCza2AhrDATvlZpW2QL0GEjNv6Eu3MlPhQKBgQDzsrbd+DRKD0ElW+y+\ngnKnoNFtu6oIs7Q/dTj9eYDBXmtx7v8eGEXKSdpRZ4YH8U1ws12ltxpzg6M0KIg8\n1nQXGdsHADyARu5NOUe/apsCZihTemSh7tuFPfuj9LESyAmeiSWQ8j58/jgWL+vp\nfYj2lcm5D8nguICsn2kNF5DpfwKBgQDqloIHvq5RqIlEK607w8E3CseYeC/n7oHy\nnA3lMmiAFhCTvSp3o9296vHjOAqazbGZmGNWnh2HF52vANDtVD5PAE/uaqQK7YcB\nB1Q27u9zsmC8iQnRgRbmLPmpno5HLlQemWaSNmCLhFk3UvXjOtQ8oaQgCnS/3eTH\ngAkuK69Z1wKBgQDWD9KfselEcJfZ2CBhy7Yo1pN/30thb3DSGQbhaDwYHvckUjoY\nVlvfb/XscZIDIgvTBkspSGhctXHDXCMnxXyd2iFRyfxa9XNXtAv48QyOE+wyP51r\nvKNpK+QBxetQwxPoBTJRWuhW5PuhSaDhLVsEtthFzb+XvJmSiEg/rsakwwKBgARy\nGcC/0lnl0cQi98N8MDs0zxeKn43LrVbFslW3oNdck6/ZE+b0ig1BWJgvxbOtVkJM\n6wUHNhQLVIeugkcdI5knrlwcVUOHwNk6JFRuLseIh+DK0A7SXXa7P3gBczzSGfIC\ngjkfIrFCLtankdVelgsYHR4mVJQWRnGpcYMYfNg9AoGAczIG8NK/Csp7T7IN14AW\nPCky1T4jEfnSJmuUQLOnnUv1lXWU7QqGI3x/nsxe0xic4GvBN0e2wQ3cqXfxXlLi\n97US3WN6CMsOsKQGaY3dnXU7t5iAHcGqegBfO5j5Mzw4mXB9JLvgBDs4kqclHPpO\n1GeiJT2IMRUa2kyKFv4/Tvk=\n-----END PRIVATE KEY-----\n",
    client_email: "firebase-adminsdk-fbsvc@orumarmsprod.iam.gserviceaccount.com",
    client_id: "100723697611119927274",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40orumarmsprod.iam.gserviceaccount.com",
    universe_domain: "googleapis.com"
};

let app;
try {
    app = admin.initializeApp({
        credential: admin.credential.cert(rmsServiceAccount),
        projectId: 'orumarmsprod'
    });
    console.log("Initialized Firebase using explicitly loaded dev credentials.");
} catch (e) {
    console.error("No FIREBASE config found. Cannot run seeder.", e);
    process.exit(1);
}

const db = admin.firestore();

// Simple CSV Parser (Handles basic quotes)
function parseCSV(csvContent) {
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return [];

    const headers = lines[0].trim().split(',').map(h => h.trim());
    const results = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const row = {};
        const values = line.split(','); // Simplified for these specific CSVs without internal commas
        headers.forEach((h, idx) => {
            row[h] = values[idx] ? values[idx].trim() : '';
        });
        results.push(row);
    }
    return results;
}

// Helper for arrays to batches
async function commitInBatches(collectionRef, dataArray, collectionName) {
    console.log(`Seeding ${dataArray.length} records into [${collectionName}]...`);
    const BATCH_SIZE = 400;

    for (let i = 0; i < dataArray.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = dataArray.slice(i, i + BATCH_SIZE);

        chunk.forEach(item => {
            const newDoc = collectionRef.doc();
            batch.set(newDoc, item);
        });

        await batch.commit();
        console.log(` - Committed batch of ${chunk.length} to ${collectionName}.`);
    }
    console.log(`Finished seeding ${collectionName}.`);
}

async function run() {
    try {
        const dataPath = 'C:/Users/oruma/Documents/testdata Veggies';

        // 1. Seed Festival Calendar
        console.log("1. Seeding Festival Calendar...");
        const festivalCsv = fs.readFileSync(path.join(dataPath, 'festival_calendar.csv'), 'utf8');
        const festivals = parseCSV(festivalCsv);
        await commitInBatches(db.collection('festivalCalendar'), festivals, 'festivalCalendar');

        // 2. Seed Purchase History
        console.log("\n2. Seeding Purchase History...");
        const historyCsv = fs.readFileSync(path.join(dataPath, 'oruma_takeout_purchase_history_dataset.csv'), 'utf8');
        const historyData = parseCSV(historyCsv);
        // Map keys exactly as expected by the JS logic: purchaseDate, restaurant, itemName, qty, unit, vendor
        const mappedHistory = historyData.map(d => ({
            purchaseDate: d.purchase_date,
            restaurant: d.restaurant,
            itemName: d.item_name,
            qty: Number(d.quantity),
            unit: d.unit,
            vendor: d.vendor,
            weekStart: getWeekStart(d.purchase_date) // Precompute week start for faster queries
        }));
        await commitInBatches(db.collection('vegetablePurchaseHistory'), mappedHistory, 'vegetablePurchaseHistory');

        // 3. Seed Vendor Catalog into "vendors/{targetVendorId}/items"
        console.log("\n3. Seeding Vendor Item Catalog...");
        const vendorSnap = await db.collection('vendors').get();
        let onThymeId = null;
        vendorSnap.docs.forEach(d => {
            const n = (d.data().name || d.data().businessName || '').toLowerCase();
            if (n.includes('thyme')) onThymeId = d.id;
        });

        if (onThymeId) {
            const catalogCsv = fs.readFileSync(path.join(dataPath, 'vendor_item_catalog.csv'), 'utf8');
            const catalogData = parseCSV(catalogCsv);
            const mappedCatalog = catalogData.map(d => ({
                name: d.item_name,
                category: d.category,
                unit: d.unit,
                price: Number(d.price) || 0,
                vendorName: d.vendor,
                status: 'Active',
                disabled: false,
                outOfStock: false
            }));
            await commitInBatches(db.collection(`vendors/${onThymeId}/items`), mappedCatalog, `vendors/${onThymeId}/items`);
        } else {
            console.warn("Could not find ON Thyme vendor document. Skipping catalog seeding.");
        }

        console.log("\n✅ All data seeding complete!");
        process.exit(0);

    } catch (e) {
        console.error("Error during seeding:", e);
        process.exit(1);
    }
}

function getWeekStart(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
}

run();
