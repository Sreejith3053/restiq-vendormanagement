const vendorCatalogV2 = require('../src/data/catalog_v2.json');
const purchaseDatasetV3 = require('../src/data/history_v3.json');

const ExactPrices = {
    "Onion - Cooking": 19.00,
    "Onion - Red": 18.00,
    "Cabbage": 24.99,
    "Capsicum Green": 3.25,
    "Capsicum Red": 3.25,
    "Capsicum Yellow": 3.25,
    "Carrot": 31.99,
    "Cauliflower": 54.00,
    "Celery": 4.00,
    "Coriander Leaves": 1.50,
    "Curry Leaves": 54.00,
    "French Beans": 4.00,
    "Ginger": 54.00,
    "Green Onion": 2.00,
    "Leeks": 5.98,
    "Lemon": 44.00,
    "Lime": 0.75,
    "Long Beans": 3.75,
    "Mint Leaves": 1.50,
    "Okra": 5.00,
    "Peeled Garlic": 32.00,
    "Pepper Mix": 3.25,
    "Plantain Green": 1.50,
    "Potatoes": 24.98,
    "Thai Chilli": 156.00,
    "Beets": 1.23,
    "Ash Guard": 1.57,
    "Tomato": 49.00
};

const ITEM_ALIAS_MAP = {
    'Coriander': 'Coriander Leaves',
    'Mint': 'Mint Leaves',
    'Onion Cooking': 'Onion - Cooking',
    'Onion Cooking 50lbs': 'Onion - Cooking',
    'Onion - Red': 'Onion - Red',
    'Onion Red 25lbs': 'Onion - Red',
    'Carrot 50lbs': 'Carrot'
};

function normalizeItemName(name) {
    if (!name) return '';
    const n = name.trim();
    return ITEM_ALIAS_MAP[n] || n;
}

const catalogLookup = {};
let loadedCatalogItems = 0;

vendorCatalogV2.forEach(row => {
    const name = row.item_name?.trim();
    const vendor = row.vendor?.trim() || 'ON Thyme';
    if (name && vendor.toLowerCase().includes('thyme')) {
        loadedCatalogItems++;
        catalogLookup[name] = {
            unit: row.unit || 'unit',
            price: ExactPrices[name] !== undefined ? ExactPrices[name] : parseFloat(row.price) || 0,
            vendor: vendor
        };
    }
});

const historyMap = {};
let loadedHistoryRows = 0;
const globalOrderDates16Wk = new Set();

let maxMs = 0;
purchaseDatasetV3.forEach(d => {
    if (d.purchase_date) {
        const m = new Date(d.purchase_date).getTime();
        if (m > maxMs) maxMs = m;
    }
});
const relativeNowMs = maxMs > 0 ? maxMs : Date.now();
const twoWeeksAgoMs = relativeNowMs - (14 * 24 * 60 * 60 * 1000);
const eightWeeksAgoMs = relativeNowMs - (56 * 24 * 60 * 60 * 1000);

purchaseDatasetV3.forEach(data => {
    if (!data.purchase_date || !data.item_name) return;
    loadedHistoryRows++;

    const recordMs = new Date(data.purchase_date).getTime();
    if (recordMs > eightWeeksAgoMs) {
        globalOrderDates16Wk.add(data.purchase_date);
    }

    const rawName = data.item_name.trim();
    const exactName = normalizeItemName(rawName);

    if (!historyMap[exactName]) {
        historyMap[exactName] = { itemName: exactName, history: [] };
    }
    historyMap[exactName].history.push({
        purchaseDate: data.purchase_date,
        qty: Number(data.quantity) || 0,
    });
});

const total16WkCycles = globalOrderDates16Wk.size || 16;
let tomatoFoundInHistory = false;
let tomatoForecasted = false;

const results = [];

Object.values(historyMap).forEach(item => {
    if (item.itemName === 'Tomato') tomatoFoundInHistory = true;

    const history = item.history.sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));

    let totalQty8Wk = 0;
    let totalQty2Wk = 0;
    let activeWeeksSet = new Set();
    let itemOrderDates16Wk = new Set();

    let varianceHigh = false;
    let lastQty = -1;

    history.forEach(record => {
        const qty = Number(record.qty) || 0;
        if (qty === 0) return;

        const recordMs = new Date(record.purchaseDate).getTime();

        if (recordMs > eightWeeksAgoMs) {
            totalQty8Wk += qty;
            if (record.purchaseDate) itemOrderDates16Wk.add(record.purchaseDate);

            const d = new Date(record.purchaseDate);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            const weekStart = new Date(d.setDate(diff)).toISOString().slice(0, 10);
            activeWeeksSet.add(weekStart);

            if (lastQty !== -1 && Math.abs(qty - lastQty) > (lastQty * 0.5)) {
                varianceHigh = true;
            }
            lastQty = qty;
        }

        if (recordMs > twoWeeksAgoMs) {
            totalQty2Wk += qty;
        }
    });

    const activeCycles = activeWeeksSet.size;
    const avg8Weeks = totalQty8Wk / 8;
    const avg2Weeks = totalQty2Wk / 2;

    let speedLabel = 'Inactive';
    if (activeCycles >= 6) speedLabel = 'Fast';
    else if (activeCycles >= 3) speedLabel = 'Medium';
    else if (activeCycles >= 1) speedLabel = 'Slow';

    let confidence = 'Low';
    if (speedLabel === 'Fast' && !varianceHigh) confidence = 'High';
    else if ((speedLabel === 'Fast' || speedLabel === 'Medium') && varianceHigh) confidence = 'Medium';
    else if (speedLabel === 'Medium' && !varianceHigh) confidence = 'High';

    let forecast = (0.6 * avg2Weeks) + (0.4 * avg8Weeks);

    const customReasonings = {
        'Onion - Cooking': 'Stable weekly demand',
        'Onion - Red': 'Moderate repeat ordering',
        'Cabbage': 'Consistent kitchen usage',
        'French Beans': 'Regular stir fry demand',
        'Mint Leaves': 'Chutney and garnish usage',
        'Okra': 'Moderate repeat demand',
        'Lemon': 'Juice and fish usage'
    };
    let reasoning = customReasonings[item.itemName] || 'Standard blended forecast.';

    if (forecast > 0) {
        if (speedLabel === 'Fast') {
            forecast *= 1.10;
        } else if (speedLabel === 'Medium') {
            forecast *= 1.05;
        }
    }

    const baselines = {
        'Onion - Cooking': 10, 'Onion - Red': 5,
        'Cabbage': 3, 'Carrot': 3, 'French Beans': 3,
        'Mint Leaves': 3, 'Coriander Leaves': 3,
        'Lemon': 2, 'Okra': 2
    };
    const itemBaseline = baselines[item.itemName] || 0;
    let appliedBaseline = false;

    if (forecast < itemBaseline) {
        forecast = itemBaseline;
        appliedBaseline = true;
    }

    const predictedTotal = Math.round(forecast);

    if (predictedTotal > 0) {
        if (appliedBaseline && (speedLabel === 'Slow' || speedLabel === 'Inactive')) {
            speedLabel = 'Medium';
        }
        if (item.itemName === 'Tomato') tomatoForecasted = true;
    }

    let predictedMonday = 0;
    let predictedThursday = 0;
    if (predictedTotal > 0) {
        predictedMonday = Math.round(predictedTotal * 0.6);
        predictedThursday = predictedTotal - predictedMonday;
    }

    const appearPercent = itemOrderDates16Wk.size / total16WkCycles;
    const cMap = catalogLookup[item.itemName];
    const isCatalogMissing = !cMap;

    results.push({
        itemName: item.itemName,
        price: cMap ? cMap.price : 0,
        totalNextWeek: predictedTotal,
        appearPercent,
        isCatalogMissing
    });
});

console.log("=== DIAGNOSTICS ===");
console.log(`History Loaded: ${loadedHistoryRows} rows`);
console.log(`Catalog Loaded: ${loadedCatalogItems} items`);
console.log(`Tomato Found In History: ${tomatoFoundInHistory ? 'Yes' : 'No'}`);
console.log(`Tomato Forecasted: ${tomatoForecasted ? 'Yes' : 'No'}`);

const suggested = results.filter(p => p.totalNextWeek === 0 && !p.isCatalogMissing && p.appearPercent >= 0.2);
console.log(`Suggested Additions: ${suggested.length}`);
if (suggested.find(p => p.itemName === 'Tomato')) console.log(">> Tomato is in Suggested Additions!");

const validItems = results.filter(p => p.totalNextWeek > 0 && !p.isCatalogMissing);
console.log("\nCorrected Active Prices:");
validItems.forEach(i => console.log(`${i.itemName}: $${i.price.toFixed(2)}`));

console.log("\nMissing Mappings (Fail Safe Triggered):");
results.filter(p => p.isCatalogMissing).forEach(i => console.log(i.itemName));
