const fs = require('fs');
const path = require('path');

function parseCSV(csvContent) {
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return [];

    const headers = lines[0].trim().split(',').map(h => h.trim());
    const results = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const row = {};
        const values = line.split(',');
        headers.forEach((h, idx) => {
            row[h] = values[idx] ? values[idx].trim() : '';
        });
        results.push(row);
    }
    return results;
}

const dataPath = 'C:/Users/oruma/Documents/testdata Veggies';
const outPath = 'C:/Users/oruma/Documents/VenorWorkSpace/restiq-vendormanagement/src/data';

if (!fs.existsSync(outPath)) {
    fs.mkdirSync(outPath, { recursive: true });
}

console.log("Reading V2 Catalog...");
const catalogCsv = fs.readFileSync(path.join(dataPath, 'vendor_item_catalog_v2.csv'), 'utf8');
const catalogRaw = parseCSV(catalogCsv);

function extractPackInfo(unitStr, itemName) {
    let base_unit = unitStr.trim();
    let pack_size = 1;
    let pack_label = base_unit;

    if (itemName === 'Cauliflower') return { base_unit: 'lb', pack_size: 25, pack_label: '25lb box' };

    const match = unitStr.match(/^([^\(]+)(?:\(([\d.]+)([a-zA-Z]*)\))?/);
    if (match) {
        base_unit = match[1].trim();
        if (base_unit === 'case') base_unit = 'unit';

        if (match[2]) {
            pack_size = parseFloat(match[2]);
            const l = match[3] ? match[3].trim() : '';
            if (l) base_unit = l;
            else if (base_unit === 'case') base_unit = 'unit';

            const origBase = match[1].trim().toLowerCase();
            if (origBase === 'box' || origBase === 'case') {
                pack_label = `${pack_size}${l} ${origBase}`;
            } else if (origBase === 'lb') {
                pack_label = `${pack_size}${l} bag`;
            } else {
                pack_label = `${pack_size}${l} ${origBase}`;
            }
        }
    }

    if (base_unit === 'box' || base_unit === 'case') base_unit = 'unit';

    return { base_unit, pack_size, pack_label };
}

const catalog = catalogRaw.map(row => {
    const info = extractPackInfo(row.unit, row.item_name);
    return {
        ...row,
        base_unit: info.base_unit,
        pack_size: info.pack_size,
        pack_label: info.pack_label
    };
});

console.log("Reading V2 Realistic History with Tomato...");
const historyCsv = fs.readFileSync(path.join(dataPath, 'oruma_takeout_realistic_dataset_v2_tomato.csv'), 'utf8');
const historyRaw = parseCSV(historyCsv);

const history = historyRaw.map(row => {
    const rawQty = parseFloat(row.quantity) || 0;
    const info = extractPackInfo(row.unit, row.item_name);
    return {
        ...row,
        normalized_quantity: rawQty,
        base_unit: info.base_unit
    };
});

console.log("Writing JSON bundles to React App...");
fs.writeFileSync(path.join(outPath, 'catalog_v2.json'), JSON.stringify(catalog, null, 2));
fs.writeFileSync(path.join(outPath, 'history_realistic_v2_tomato.json'), JSON.stringify(history, null, 2));

console.log(`Loaded ${catalog.length} catalog items and ${history.length} history records.`);
