/**
 * Local Test Script: AI Forecast Engine using CSV test data
 * 
 * Reads the Oruma Takeout CSV dataset, converts it to the format the engine expects,
 * runs both deterministic (exponential smoothing) and AI (Gemini) predictions,
 * then compares and prints results for selected items.
 * 
 * Usage: node functions/testForecastWithCSV.js
 * 
 * Requirements: GOOGLE_APPLICATION_CREDENTIALS env variable set, or run inside a GCP-authenticated shell.
 */

const fs = require('fs');
const path = require('path');

// --- Import engine helpers (we replicate the pure functions locally) ---

function buildWeeklyBuckets(orders) {
    if (!orders || orders.length === 0) return [];
    const bucketMap = {};
    orders.forEach(order => {
        const orderDate = new Date(order.orderDate);
        const day = orderDate.getDay();
        const diff = (day === 0 ? -6 : 1) - day;
        const monday = new Date(orderDate);
        monday.setDate(orderDate.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

        if (!bucketMap[weekKey]) {
            bucketMap[weekKey] = { weekLabel: weekKey, weekStart: monday, totalQty: 0, mondayQty: 0, thursdayQty: 0 };
        }
        bucketMap[weekKey].totalQty += order.quantity;

        const orderDay = orderDate.getDay();
        if (orderDay >= 0 && orderDay <= 3) {
            bucketMap[weekKey].mondayQty += order.quantity;
        } else {
            bucketMap[weekKey].thursdayQty += order.quantity;
        }
    });
    return Object.values(bucketMap).sort((a, b) => a.weekStart - b.weekStart);
}

function exponentialSmoothing(values, alpha = 0.3) {
    if (!values || values.length === 0) return 0;
    let smoothed = values[0];
    for (let i = 1; i < values.length; i++) {
        smoothed = alpha * values[i] + (1 - alpha) * smoothed;
    }
    return smoothed;
}

// --- CSV Parser ---
function parseCSV(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < headers.length) continue;
        rows.push({
            orderDate: parts[0].trim(),      // purchase_date
            restaurantId: 'oruma-takeout',
            restaurantName: parts[1].trim(),  // restaurant
            itemId: parts[2].trim().toLowerCase().replace(/\s+/g, '-'),   // derive ID from name
            itemName: parts[2].trim(),        // item_name
            quantity: parseFloat(parts[3].trim()),  // quantity
            unit: parts[4].trim(),            // unit
            vendorId: parts[5].trim().toLowerCase().replace(/\s+/g, '-'), // derive ID from name
            vendorName: parts[5].trim(),      // vendor
            category: 'Vegetables'            // All items in this dataset are vegetables
        });
    }
    return rows;
}

// --- Main ---
async function main() {
    const csvPath = path.join(__dirname, '..', 'src', 'components', 'testData', 'oruma_takeout_realistic_dataset_v2_tomato.csv');

    console.log("=".repeat(80));
    console.log("  AI FORECAST ENGINE — LOCAL TEST WITH CSV DATA");
    console.log("=".repeat(80));
    console.log(`\nReading: ${csvPath}\n`);

    const allOrders = parseCSV(csvPath);
    console.log(`Total order rows parsed: ${allOrders.length}`);

    // Group by item
    const grouped = {};
    allOrders.forEach(order => {
        if (!grouped[order.itemId]) {
            grouped[order.itemId] = { ...order, history: [] };
        }
        grouped[order.itemId].history.push(order);
    });

    const itemNames = Object.keys(grouped);
    console.log(`Unique items: ${itemNames.length}`);
    console.log(`Items: ${itemNames.map(k => grouped[k].itemName).join(', ')}\n`);

    // Pick a few focus items for detailed output
    const focusItems = ['tomato', 'onion---cooking', 'carrot', 'cabbage', 'mint-leaves'];
    const allResults = [];

    console.log("-".repeat(80));

    // Try to load AI prediction
    let generateAIPrediction = null;
    try {
        const gemini = require('./geminiIntegration');
        generateAIPrediction = gemini.generateAIPrediction;
        console.log("✅ Gemini AI module loaded — will attempt AI predictions.\n");
    } catch (err) {
        console.log("⚠️  Gemini AI module not available (missing credentials or dependencies).");
        console.log("    Running DETERMINISTIC-ONLY mode.\n");
    }

    for (const itemId of itemNames) {
        const data = grouped[itemId];
        const weeklyBuckets = buildWeeklyBuckets(data.history);

        if (weeklyBuckets.length === 0) continue;

        // --- Short-term (last 8 weeks) ---
        const recentBuckets = weeklyBuckets.slice(-8);
        const recentQtys = recentBuckets.map(b => b.totalQty);
        const shortTermAvg = recentQtys.reduce((a, b) => a + b, 0) / recentQtys.length;

        // --- Seasonal (same period last year: weeks 48-52 ago) ---
        let seasonalAvg = null;
        if (weeklyBuckets.length > 44) {
            const seasonalBuckets = weeklyBuckets.slice(-52, -44);
            if (seasonalBuckets.length > 0) {
                const seasonalQtys = seasonalBuckets.map(b => b.totalQty);
                seasonalAvg = seasonalQtys.reduce((a, b) => a + b, 0) / seasonalQtys.length;
            }
        }

        // --- Delivery day split ---
        const totalRecentQty = recentBuckets.reduce((s, b) => s + b.totalQty, 0);
        const totalRecentMon = recentBuckets.reduce((s, b) => s + b.mondayQty, 0);
        const mondaySplitPercent = totalRecentQty > 0 ? (totalRecentMon / totalRecentQty) * 100 : 40;
        const thursdaySplitPercent = 100 - mondaySplitPercent;

        // --- Deterministic: exponential smoothing ---
        const deterministicQty = Math.ceil(exponentialSmoothing(recentQtys, 0.3));

        // --- Old method: flat average ---
        const oldFlatAvg = Math.ceil(recentQtys.reduce((a, b) => a + b, 0) / recentQtys.length);

        // --- Trend ---
        let trend = "Stable";
        if (recentBuckets.length >= 4) {
            const firstHalf = recentQtys.slice(0, Math.floor(recentQtys.length / 2));
            const secondHalf = recentQtys.slice(Math.floor(recentQtys.length / 2));
            const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
            if (secondAvg > firstAvg * 1.1) trend = "Increasing";
            else if (secondAvg < firstAvg * 0.9) trend = "Decreasing";
        }

        // --- AI Prediction (if available) ---
        let aiResult = null;
        if (generateAIPrediction) {
            const recentWeeksStr = recentBuckets
                .slice().reverse()
                .map((b, i) => `  ${i === 0 ? 'Most recent' : `${i + 1} weeks ago`}: ${b.totalQty} ${data.unit}`)
                .join('\n');

            try {
                aiResult = await generateAIPrediction({
                    itemName: data.itemName,
                    category: data.category,
                    unit: data.unit,
                    weeklyBuckets: weeklyBuckets.map(b => b.totalQty),
                    weeklyBucketLabels: weeklyBuckets.map(b => b.weekLabel),
                    recentWeeksStr,
                    shortTermAvg,
                    seasonalAvg,
                    mondaySplitPercent,
                    thursdaySplitPercent,
                    activeEvents: null,
                    eventUpliftPercent: null
                });
            } catch (err) {
                // Silently skip AI for this item
            }
        }

        const result = {
            itemName: data.itemName,
            unit: data.unit,
            totalWeeksOfData: weeklyBuckets.length,
            trend,
            shortTermAvg: parseFloat(shortTermAvg.toFixed(1)),
            seasonalAvg: seasonalAvg !== null ? parseFloat(seasonalAvg.toFixed(1)) : 'N/A',
            oldFlatAvg,
            deterministicQty,
            aiPrediction: aiResult ? aiResult.predictedWeeklyQty : 'N/A',
            aiConfidence: aiResult ? aiResult.confidence : 'N/A',
            aiReasoning: aiResult ? aiResult.reasoning : null,
            mondaySplit: `${mondaySplitPercent.toFixed(0)}%`,
            thursdaySplit: `${thursdaySplitPercent.toFixed(0)}%`
        };
        allResults.push(result);

        // Detailed output for focus items
        if (focusItems.includes(itemId)) {
            console.log(`\n${"=".repeat(60)}`);
            console.log(`  📦 ${data.itemName} (${data.unit})`);
            console.log("=".repeat(60));
            console.log(`  Weeks of data:    ${weeklyBuckets.length}`);
            console.log(`  Trend:            ${trend}`);
            console.log(`  Mon/Thu split:    ${mondaySplitPercent.toFixed(0)}% / ${thursdaySplitPercent.toFixed(0)}%`);
            console.log(`  Short-term avg:   ${shortTermAvg.toFixed(1)} ${data.unit}/week`);
            console.log(`  Seasonal avg:     ${seasonalAvg !== null ? seasonalAvg.toFixed(1) : 'N/A (< 1 year data)'}`);
            console.log(`\n  Recent 8 weeks (newest first):`);
            recentBuckets.slice().reverse().forEach((b, i) => {
                console.log(`    ${b.weekLabel}: ${b.totalQty} (Mon: ${b.mondayQty}, Thu: ${b.thursdayQty})`);
            });
            console.log(`\n  ─── PREDICTIONS ───`);
            console.log(`  Old flat average:          ${oldFlatAvg} ${data.unit}`);
            console.log(`  New exponential smoothing: ${deterministicQty} ${data.unit}`);
            if (aiResult) {
                console.log(`  🤖 AI prediction:          ${aiResult.predictedWeeklyQty} ${data.unit} (${aiResult.confidence} confidence)`);
                console.log(`     AI reasoning:           ${aiResult.reasoning}`);
            } else {
                console.log(`  🤖 AI prediction:          Skipped or unavailable`);
            }
        }
    }

    // Summary table
    console.log(`\n\n${"=".repeat(100)}`);
    console.log("  SUMMARY TABLE: All Items");
    console.log("=".repeat(100));
    console.log(`${"Item".padEnd(22)} ${"Unit".padEnd(14)} ${"Wks".padStart(4)} ${"Trend".padEnd(12)} ${"OldAvg".padStart(7)} ${"ExpSmooth".padStart(10)} ${"AIPred".padStart(7)} ${"Conf".padEnd(8)} ${"Split".padEnd(10)}`);
    console.log("-".repeat(100));
    allResults.sort((a, b) => a.itemName.localeCompare(b.itemName)).forEach(r => {
        console.log(`${r.itemName.padEnd(22)} ${r.unit.padEnd(14)} ${String(r.totalWeeksOfData).padStart(4)} ${r.trend.padEnd(12)} ${String(r.oldFlatAvg).padStart(7)} ${String(r.deterministicQty).padStart(10)} ${String(r.aiPrediction).padStart(7)} ${String(r.aiConfidence).padEnd(8)} ${r.mondaySplit}/${r.thursdaySplit}`);
    });

    console.log(`\n✅ Test complete. ${allResults.filter(r => r.aiPrediction !== 'N/A').length}/${allResults.length} items received AI predictions.`);
}

main().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
