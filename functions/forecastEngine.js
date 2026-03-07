const { getSeasonalityUplifts } = require("./seasonalityEngine");
const { generateForecastReasoning, generateVendorPlanningNote } = require("./geminiIntegration");

async function runDeterministicForecast(db) {
    console.log("Starting Deterministic Forecast...");
    // Week definitions (Simplistic for demonstration, use a robust date-fns approach in production)
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
    const weekStartKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const nextWeekStart = d; // for seasonality engine

    // 1. Fetch Config
    let config = {
        weights: [0.4, 0.3, 0.2, 0.1], // Last 4 weeks
        safetyBufferPercent: 0.10,
        defaultMondaySplit: 0.40,
        defaultThursdaySplit: 0.60
    };
    const configDoc = await db.collection('forecastConfig').doc('global').get();
    if (configDoc.exists) config = { ...config, ...configDoc.data() };

    // 2. Fetch Historical Orders (Last 8 weeks)
    const eightWeeksAgo = new Date();
    eightWeeksAgo.setDate(d.getDate() - 56);

    // Naively grouping everything. In production, paginate or do map-reduce.
    const ordersSnap = await db.collection('marketplaceOrders')
        .where('orderDate', '>=', eightWeeksAgo.toISOString())
        .get();

    // Group by restaurant -> item
    const grouped = {};
    ordersSnap.forEach(doc => {
        const order = doc.data();
        const key = `${order.restaurantId}_${order.itemId}`;
        if (!grouped[key]) {
            grouped[key] = {
                restaurantId: order.restaurantId,
                restaurantName: order.restaurantName || 'Unknown',
                itemId: order.itemId,
                itemName: order.itemName,
                category: order.category,
                unit: order.unit,
                vendorId: order.vendorId,
                vendorName: order.vendorName,
                history: []
            };
        }
        grouped[key].history.push(order);
    });

    // 3. Process each group
    const forecastBatch = db.batch();
    for (const key in grouped) {
        const data = grouped[key];

        // Calculate weekly sums
        let totalQty = 0;
        let mondayBucketQty = 0; // Approx orders placed strictly for Mon-Wed
        let thursdayBucketQty = 0; // Approx orders placed strictly for Thu-Sun

        data.history.forEach(order => {
            totalQty += order.quantity;
            const day = new Date(order.orderDate).getDay();
            if (day >= 0 && day <= 3) {
                // Sunday, Monday, Tuesday, Wednesday (Affects Monday delivery window)
                mondayBucketQty += order.quantity;
            } else {
                // Thursday, Friday, Saturday (Affects Thursday delivery window)
                thursdayBucketQty += order.quantity;
            }
        });

        const numWeeks = 8;
        let avgWeeklyQty = totalQty / numWeeks;
        if (avgWeeklyQty === 0) continue; // Skip items with no real history

        // Determine split %
        let mondaySplitPercent = data.history.length > 0 ? (mondayBucketQty / totalQty) * 100 : config.defaultMondaySplit * 100;
        let thursdaySplitPercent = data.history.length > 0 ? (thursdayBucketQty / totalQty) * 100 : config.defaultThursdaySplit * 100;

        // Apply Seasonality
        const uplifts = await getSeasonalityUplifts(db, data.itemId, data.category, nextWeekStart);
        let eventName = null;
        let isEventAffected = false;
        if (uplifts && uplifts.length > 0) {
            isEventAffected = true;
            eventName = uplifts[0].eventName;
            // Apply nominal uplift simply
            avgWeeklyQty = avgWeeklyQty * (1 + (uplifts[0].percent / 100));
        }

        const predictedWeeklyQty = Math.ceil(avgWeeklyQty);
        let predictedMondayDeliveryQty = Math.ceil(predictedWeeklyQty * (mondaySplitPercent / 100));
        let predictedThursdayDeliveryQty = Math.ceil(predictedWeeklyQty * (thursdaySplitPercent / 100));

        // Safety stock
        const safetyBufferQty = Math.ceil(predictedWeeklyQty * config.safetyBufferPercent);
        const recommendedDispatchQty = predictedWeeklyQty + safetyBufferQty;

        // Trend logic
        const trend = (avgWeeklyQty > (totalQty / numWeeks)) ? "Increasing" : "Stable";
        const confidence = data.history.length > 10 ? "High" : "Low";

        // 4. Generate AI Insights
        const forecastReasoning = await generateForecastReasoning({
            itemName: data.itemName,
            trend,
            confidence,
            mondaySplitPercent: mondaySplitPercent.toFixed(0),
            thursdaySplitPercent: thursdaySplitPercent.toFixed(0),
            weeksOfHistory: 8,
            eventImpact: isEventAffected,
            eventName
        });

        // 5. Save to Firestore
        const docRef = db.collection('restaurantItemForecasts').doc(`${data.restaurantId}_${data.itemId}_${weekStartKey}`);
        forecastBatch.set(docRef, {
            ...data,
            weekStart: weekStartKey,
            avgWeeklyQty,
            predictedWeeklyQty,
            predictedMondayDeliveryQty,
            predictedThursdayDeliveryQty,
            mondaySplitPercent,
            thursdaySplitPercent,
            trend,
            confidence,
            safetyBufferQty,
            recommendedDispatchQty,
            forecastReasoning,
            isEventAffected,
            eventNamesApplied: eventName ? [eventName] : [],
            generatedAt: new Date().toISOString()
        });
    }

    await forecastBatch.commit();
    console.log("Deterministic Forecast Saved.");
}

async function aggregateForecasts(db) {
    console.log("Aggregating Forecasts...");

    // Simplistic approach for demo. Production should run an aggregation query or aggregation cloud function.
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
    const weekStartKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const snapshot = await db.collection('restaurantItemForecasts')
        .where('weekStart', '==', weekStartKey)
        .get();

    const aggregate = {};
    snapshot.forEach(doc => {
        const item = doc.data();
        if (!aggregate[item.itemId]) {
            aggregate[item.itemId] = {
                itemId: item.itemId,
                itemName: item.itemName,
                category: item.category,
                unit: item.unit,
                vendorId: item.vendorId,
                vendorName: item.vendorName,
                totalPredictedWeeklyQty: 0,
                totalPredictedMondayDeliveryQty: 0,
                totalPredictedThursdayDeliveryQty: 0,
                restaurantsCount: 0,
                weekStart: weekStartKey
            };
        }
        aggregate[item.itemId].totalPredictedWeeklyQty += item.predictedWeeklyQty;
        aggregate[item.itemId].totalPredictedMondayDeliveryQty += item.predictedMondayDeliveryQty;
        aggregate[item.itemId].totalPredictedThursdayDeliveryQty += item.predictedThursdayDeliveryQty;
        aggregate[item.itemId].restaurantsCount += 1;
    });

    const batch = db.batch();
    for (const key in aggregate) {
        const ref = db.collection('aggregateItemForecasts').doc(`${key}_${weekStartKey}`);
        batch.set(ref, {
            ...aggregate[key],
            generatedAt: new Date().toISOString()
        });
    }
    await batch.commit();
    console.log("Aggregations Built.");
}

async function generateVendorRollups(db) {
    console.log("Generating Vendor Rollups...");
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
    const weekStartKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const snapshot = await db.collection('aggregateItemForecasts')
        .where('weekStart', '==', weekStartKey)
        .get();

    const vendorMap = {};
    snapshot.forEach(doc => {
        const data = doc.data();
        if (!vendorMap[data.vendorId]) {
            vendorMap[data.vendorId] = {
                vendorId: data.vendorId,
                vendorName: data.vendorName,
                weekStart: weekStartKey,
                totalWeeklyDemand: 0,
                totalMondayDemand: 0,
                totalThursdayDemand: 0,
                itemForecasts: []
            };
        }
        vendorMap[data.vendorId].totalWeeklyDemand += data.totalPredictedWeeklyQty;
        vendorMap[data.vendorId].totalMondayDemand += data.totalPredictedMondayDeliveryQty;
        vendorMap[data.vendorId].totalThursdayDemand += data.totalPredictedThursdayDeliveryQty;
        vendorMap[data.vendorId].itemForecasts.push(data);
    });

    const batch = db.batch();
    for (const vId in vendorMap) {
        const vData = vendorMap[vId];

        // AI Vendor Planning Note on the top item
        let planningNotes = "Prepare standard orders.";
        if (vData.itemForecasts.length > 0) {
            const topItem = vData.itemForecasts.sort((a, b) => b.totalPredictedWeeklyQty - a.totalPredictedWeeklyQty)[0];
            planningNotes = await generateVendorPlanningNote({
                vendorName: vData.vendorName,
                itemName: topItem.itemName,
                mondayQty: topItem.totalPredictedMondayDeliveryQty,
                thursdayQty: topItem.totalPredictedThursdayDeliveryQty,
                trend: "Stable"
            });
        }

        const ref = db.collection('vendorPlanningForecasts').doc(`${vId}_${weekStartKey}`);
        batch.set(ref, {
            ...vData,
            planningNotes,
            generatedAt: new Date().toISOString()
        });
    }
    await batch.commit();
    console.log("Vendor Rollups Generated.");
}

module.exports = {
    runDeterministicForecast,
    aggregateForecasts,
    generateVendorRollups
};
