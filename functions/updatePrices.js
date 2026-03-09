const fs = require('fs');
const path = require('path');

exports.updateCatalogPrices = async function (db) {
    const dataPath = 'C:/Users/oruma/Documents/testdata Veggies';
    const catalogCsv = fs.readFileSync(path.join(dataPath, 'vendor_item_catalog.csv'), 'utf8');

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
        if (row.item_name) {
            catalogMap[row.item_name.trim()] = Number(row.price) || 0;
        }
    }

    const vendorSnap = await db.collection('vendors').get();
    let onThymeId = null;
    vendorSnap.docs.forEach(d => {
        if ((d.data().name || d.data().businessName || '').toLowerCase().includes('thyme')) {
            onThymeId = d.id;
        }
    });

    if (!onThymeId) {
        console.error('ON Thyme vendor not found!');
        return;
    }

    const itemsRef = db.collection(`vendors/${onThymeId}/items`);
    const itemsSnap = await itemsRef.get();

    const batch = db.batch();
    let count = 0;
    itemsSnap.docs.forEach(doc => {
        const name = doc.data().name;
        if (name && catalogMap[name.trim()] !== undefined) {
            batch.update(doc.ref, { price: catalogMap[name.trim()] });
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Updated ${count} vendor items with exact numerical prices!`);
    } else {
        console.log('No item matches found to update prices.');
    }
}
