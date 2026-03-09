const fs = require('fs');
const path = require('path');
const d = require(path.join(__dirname, '../src/data/history_realistic_v2.json'));

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

const getMedian = arr => { if (arr.length === 0) return 0; const s = [...arr].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]; };

const historyMap = {};
const dates = new Set();
d.forEach(x => dates.add(x.purchase_date));
const allDates = [...dates].sort((a, b) => new Date(b) - new Date(a));
const d8 = allDates.slice(0, 8);
const d4 = allDates.slice(0, 4);

d.forEach(x => {
    const name = normalizeItemName(x.item_name);
    if (!historyMap[name]) historyMap[name] = {};
    historyMap[name][x.purchase_date] = (historyMap[name][x.purchase_date] || 0) + Number(x.normalized_quantity);
});

Object.keys(historyMap).forEach(name => {
    const q8 = d8.map(date => historyMap[name][date] || 0);
    const q4 = d4.map(date => historyMap[name][date] || 0);

    const q8f = q8.filter(x => x > 0);
    const q4f = q4.filter(x => x > 0);

    const freq = q8f.length;

    // What if we just output the exact frequency/median stats?
    console.log(`${name.padEnd(20)} | Freq: ${freq}/8 | MedFilt8: ${getMedian(q8f).toFixed(1)} | MedUnfilt8: ${getMedian(q8).toFixed(1)} | MedFilt4: ${getMedian(q4f).toFixed(1)}`);
});
