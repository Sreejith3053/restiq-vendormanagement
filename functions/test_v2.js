const purchaseDatasetV2 = require('../src/data/history_realistic_v2.json');

const ITEM_ALIAS_MAP = {
    'white onion': 'Onion - Cooking',
    'red onion': 'Onion - Red',
    'spring onion': 'Green Onion',
    'garlic': 'Peeled Garlic',
    'green plantain': 'Plantain Green',
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
    const n = name.trim().toLowerCase();
    const mappedKey = Object.keys(ITEM_ALIAS_MAP).find(k => k.toLowerCase() === n);
    return mappedKey ? ITEM_ALIAS_MAP[mappedKey] : name.trim();
}

function getMedian(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
}

const globalDatesSet = new Set();
purchaseDatasetV2.forEach(d => {
    if (d.purchase_date) globalDatesSet.add(d.purchase_date);
});

const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
const last8Cycles = allCycles.slice(0, 8);
const last4Cycles = allCycles.slice(0, 4);

const historyMap = {};

purchaseDatasetV2.forEach(data => {
    if (!data.purchase_date || !data.item_name) return;
    const exactName = normalizeItemName(data.item_name);
    if (!historyMap[exactName]) {
        historyMap[exactName] = { itemName: exactName, orderHistoryMap: {}, appearanceCount: 0 };
    }
    const qty = Number(data.normalized_quantity) || 0; // The issue might be that normalized_quantity is now equal to raw quantity. What if we use raw quantity? Yes, normalized_quantity is raw quantity.
    if (!historyMap[exactName].orderHistoryMap[data.purchase_date]) {
        historyMap[exactName].orderHistoryMap[data.purchase_date] = 0;
    }
    historyMap[exactName].orderHistoryMap[data.purchase_date] += qty;
});

Object.values(historyMap).forEach(item => {
    item.appearanceCount = Object.keys(item.orderHistoryMap).length;
});

const purchaseResults = [];
const totalCycles = allCycles.length;

Object.values(historyMap).forEach(item => {
    const qtyIn8 = last8Cycles.map(date => item.orderHistoryMap[date] || 0);
    const qtyIn4 = last4Cycles.map(date => item.orderHistoryMap[date] || 0);

    const qtyIn8Filtered = qtyIn8.filter(q => q > 0);
    const qtyIn4Filtered = qtyIn4.filter(q => q > 0);

    const median8 = getMedian(qtyIn8Filtered);
    const median4 = getMedian(qtyIn4Filtered);

    let forecastQty = (0.6 * median4) + (0.4 * median8);
    const predictedTotal = Math.ceil(forecastQty);

    const appearPercent = item.appearanceCount / totalCycles;
    let speed = 'Slow';
    if (appearPercent > 0.7) speed = 'Fast';
    else if (appearPercent > 0.3) speed = 'Medium';

    if (predictedTotal > 0 && appearPercent > 0.5) { // Try > 0.5 for fast movers? "recent frequency, repeat ordering behavior"
        // Wait, User prompt 4149 says:
        /*
        Onion Cooking | Fast | 6 | 4 | 10
        Onion Red | Fast | 3 | 2 | 5
        Cabbage | Fast | 2 | 1 | 3
        Carrot | Fast | 2 | 1 | 3
        French Beans | Fast | 2 | 1 | 3
        Mint Leaves | Medium | 2 | 1 | 3
        Coriander Leaves | Medium | 2 | 1 | 3
        Lemon | Medium | 1 | 1 | 2
        Okra | Medium | 1 | 1 | 2
        */
        let mondayQty = Math.round(predictedTotal * 0.6);
        let thursdayQty = predictedTotal - mondayQty;

        purchaseResults.push({
            itemName: item.itemName,
            speed,
            predictedTotal,
            mondayQty,
            thursdayQty,
            appearPercent,
            median4, median8,
            qtyIn8Filtered,
            medianUnfiltered4: getMedian(qtyIn4),
            medianUnfiltered8: getMedian(qtyIn8)
        });
    }
});

purchaseResults.sort((a, b) => b.predictedTotal - a.predictedTotal || b.appearPercent - a.appearPercent);

purchaseResults.forEach(p => {
    console.log(`${p.itemName} | ${p.speed} | M:${p.mondayQty} + T:${p.thursdayQty} = ${p.predictedTotal} (Unfiltered: ${p.medianUnfiltered4}, ${p.medianUnfiltered8})`);
});
