const purchaseDatasetV2 = require('../src/data/history_realistic_v2.json');
const vendorCatalogV2 = require('../src/data/catalog_v2.json');

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

const catalogLookup = {};
vendorCatalogV2.forEach(row => {
    const name = row.item_name?.trim();
    if (name) {
        catalogLookup[name] = {
            base_unit: row.base_unit || 'unit',
            pack_size: row.pack_size || 1,
            pack_label: row.pack_label || 'unit',
            price: parseFloat(row.price) || 0,
        };
    }
});

const globalDatesSet = new Set();
purchaseDatasetV2.forEach(d => {
    if (d.purchase_date) globalDatesSet.add(d.purchase_date);
});

const allCycles = [...globalDatesSet].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
const last8Cycles = allCycles.slice(0, 8);
const last4Cycles = allCycles.slice(0, 4);

const historyMap = {};
const itemDatesMap = {};

purchaseDatasetV2.forEach(data => {
    if (!data.purchase_date || !data.item_name) return;
    const exactName = normalizeItemName(data.item_name);
    if (!historyMap[exactName]) {
        historyMap[exactName] = { itemName: exactName, orderHistoryMap: {}, appearanceCount: 0 };
        itemDatesMap[exactName] = new Set();
    }
    const qty = Number(data.normalized_quantity) || 0;
    if (!historyMap[exactName].orderHistoryMap[data.purchase_date]) {
        historyMap[exactName].orderHistoryMap[data.purchase_date] = 0;
    }
    historyMap[exactName].orderHistoryMap[data.purchase_date] += qty;
    itemDatesMap[exactName].add(data.purchase_date);
});

Object.values(historyMap).forEach(item => {
    item.appearanceCount = Object.keys(item.orderHistoryMap).length;
});

const totalGlobalCycles = allCycles.length;

const purchaseResults = [];
const nonPredictedItems = [];
const mainItemDates = new Set();

Object.values(historyMap).forEach(item => {
    // DO NOT filter out zeroes. A week with 0 orders means 0 demand.
    const qtyIn8 = last8Cycles.map(date => item.orderHistoryMap[date] || 0);
    const qtyIn4 = last4Cycles.map(date => item.orderHistoryMap[date] || 0);

    const median8 = getMedian(qtyIn8);
    const median4 = getMedian(qtyIn4);

    let forecastQty = (0.6 * median4) + (0.4 * median8);
    const predictedTotal = Math.ceil(forecastQty);

    const cMap = catalogLookup[item.itemName];
    const isCatalogMissing = !cMap;

    let speed = 'Slow';
    const appearPercent = item.appearanceCount / totalGlobalCycles;
    if (appearPercent > 0.7) speed = 'Fast';
    else if (appearPercent > 0.3) speed = 'Medium';

    if (predictedTotal > 0 && cMap) {
        let packsNeeded = 0;
        if (cMap.pack_size > 1) {
            packsNeeded = Math.ceil(predictedTotal / cMap.pack_size);
        } else {
            packsNeeded = predictedTotal;
        }

        let mondayQty = Math.round(packsNeeded * 0.6);
        let thursdayQty = packsNeeded - mondayQty;

        purchaseResults.push({
            itemName: item.itemName,
            speed,
            packsNeeded,
            mondayQty,
            thursdayQty,
            pack: cMap.pack_label
        });

        itemDatesMap[item.itemName].forEach(d => mainItemDates.add(d));

    } else if (!isCatalogMissing) {
        nonPredictedItems.push({
            itemName: item.itemName,
            appearPercent,
            datesOrdered: itemDatesMap[item.itemName],
            orderedLastCycle: !!item.orderHistoryMap[last8Cycles[0]],
            qtyIn8_nonzero: qtyIn8.filter(q => q > 0).length,
            pack_label: cMap.pack_label
        });
    }
});

purchaseResults.sort((a, b) => b.packsNeeded - a.packsNeeded);

const suggestedResults = [];

nonPredictedItems.forEach(item => {
    let score = 0;
    let reasons = [];

    score += item.appearPercent * 10;
    if (item.appearPercent > 0.5) reasons.push("Common supporting ingredient in past orders");

    if (item.orderedLastCycle) {
        score += 5;
        reasons.push("Recent add-on item");
    }

    let overlapCount = 0;
    item.datesOrdered.forEach(d => {
        if (mainItemDates.has(d)) overlapCount++;
    });
    let overlapRatio = item.datesOrdered.size > 0 ? overlapCount / item.datesOrdered.size : 0;
    if (overlapRatio > 0.8 && item.datesOrdered.size > 2) {
        score += 4;
        reasons.push("Frequently bought with main predicted items");
    }

    if (item.qtyIn8_nonzero > 0 && item.qtyIn8_nonzero < 3) {
        score += 2;
        reasons.push("Appears in similar historical weeks");
    }

    if (reasons.length === 0 && item.appearPercent > 0.2) {
        reasons.push("Seasonal supporting item");
        score += 2;
    }

    if (score > 3) {
        suggestedResults.push({
            itemName: item.itemName,
            score,
            suggestedQty: 1,
            reason: reasons[0] || 'AI suggested addition',
            pack: item.pack_label
        });
    }
});

suggestedResults.sort((a, b) => b.score - a.score);
const finalSuggestions = suggestedResults.slice(0, 6);

console.log("=== MAIN ORDER ===");
purchaseResults.forEach(p => console.log(`${p.itemName} | ${p.speed} | M:${p.mondayQty} + T:${p.thursdayQty} = ${p.packsNeeded}`));

console.log("\n=== AI SUGGESTIONS ===");
finalSuggestions.forEach(s => console.log(`${s.itemName} | Score: ${s.score.toFixed(1)} | Qty: ${s.suggestedQty} | Reason: ${s.reason}`));
