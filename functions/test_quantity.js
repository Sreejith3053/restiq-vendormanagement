const d = require('../src/data/history_realistic_v2.json');
const getMedian = arr => { if (arr.length === 0) return 0; const s = [...arr].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]; };

const historyMap = {};
const dates = new Set();
d.forEach(x => { if (x.purchase_date) dates.add(x.purchase_date) });
const allDates = [...dates].sort((a, b) => new Date(b) - new Date(a));
const d8 = allDates.slice(0, 8);
const d4 = allDates.slice(0, 4);

const ITEM_ALIAS_MAP = { 'white onion': 'Onion - Cooking', 'red onion': 'Onion - Red', 'spring onion': 'Green Onion', 'garlic': 'Peeled Garlic', 'green plantain': 'Plantain Green', 'Coriander': 'Coriander Leaves', 'Mint': 'Mint Leaves', 'Onion Cooking': 'Onion - Cooking', 'Onion Cooking 50lbs': 'Onion - Cooking', 'Onion - Red': 'Onion - Red', 'Onion Red 25lbs': 'Onion - Red', 'Carrot 50lbs': 'Carrot' };
function normalizeItemName(name) {
    if (!name) return '';
    const n = name.trim().toLowerCase();
    const mappedKey = Object.keys(ITEM_ALIAS_MAP).find(k => k.toLowerCase() === n);
    return mappedKey ? ITEM_ALIAS_MAP[mappedKey] : name.trim();
}

d.forEach(x => {
    if (!x.purchase_date || !x.item_name) return;
    const name = normalizeItemName(x.item_name);
    if (!historyMap[name]) historyMap[name] = {};
    historyMap[name][x.purchase_date] = (historyMap[name][x.purchase_date] || 0) + Number(x.normalized_quantity);
});

const targets = ['Onion - Cooking', 'Onion - Red', 'Cabbage', 'Carrot', 'French Beans', 'Mint Leaves', 'Coriander Leaves', 'Lemon', 'Okra'];

targets.forEach(name => {
    let q8 = d8.map(date => historyMap[name][date] || 0);
    let q4 = d4.map(date => historyMap[name][date] || 0);

    // Filtered vs unfiltered
    let q8f = q8.filter(x => x > 0);
    let q4f = q4.filter(x => x > 0);

    const m8 = getMedian(q8);
    const m4 = getMedian(q4);

    const m8f = getMedian(q8f);
    const m4f = getMedian(q4f);

    // Try mixing unfiltered 8-cycle to ground it + light filtered 4-cycle for trend?
    let calmQty = Math.ceil((0.6 * m8) + (0.4 * m4f));

    // Check capping
    const cap = q8f.length > 1 ? q8f.sort((a, b) => b - a)[1] : q8f[0];

    // Let's print the combos
    console.log(`${name.padEnd(16)} | m8(U): ${m8.toFixed(1)} | m4(U): ${m4.toFixed(1)} | m8(F): ${m8f.toFixed(1)} | m4(F): ${m4f.toFixed(1)} | Cap: ${cap}`);
});
