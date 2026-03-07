/**
 * Compares the forecast predictions from the previous week against actual orders 
 * that fell within that week's date window, logging the variances.
 */
async function checkForecastAccuracy(db) {
    console.log("Starting forecast accuracy reconciliation...");
    const now = new Date();
    const prevWeekStart = new Date(now);
    prevWeekStart.setHours(0, 0, 0, 0);
    prevWeekStart.setDate(now.getDate() - 7 - ((now.getDay() || 7) - 1));
    const weekStartKey = `${prevWeekStart.getFullYear()}-${String(prevWeekStart.getMonth() + 1).padStart(2, '0')}-${String(prevWeekStart.getDate()).padStart(2, '0')}`;

    const prevWeekEnd = new Date(prevWeekStart);
    prevWeekEnd.setDate(prevWeekStart.getDate() + 7);

    // 1. Fetch Forecasts from last week
    const forecastsSnap = await db.collection('restaurantItemForecasts')
        .where('weekStart', '==', weekStartKey)
        .get();

    if (forecastsSnap.empty) {
        console.log(`No forecasts found for week ${weekStartKey} to reconcile.`);
        return;
    }

    // 2. Fetch Actual Orders from last week
    const ordersSnap = await db.collection('marketplaceOrders')
        .where('orderDate', '>=', prevWeekStart.toISOString())
        .where('orderDate', '<', prevWeekEnd.toISOString())
        .get();

    // Map actuals
    const actualsMap = {};
    ordersSnap.forEach(doc => {
        const order = doc.data();
        const key = `${order.restaurantId}_${order.itemId}`;
        if (!actualsMap[key]) {
            actualsMap[key] = {
                actualMondayQty: 0,
                actualThursdayQty: 0,
                actualWeeklyQty: 0
            };
        }
        actualsMap[key].actualWeeklyQty += order.quantity;

        const day = new Date(order.orderDate).getDay();
        if (day >= 0 && day <= 3) {
            actualsMap[key].actualMondayQty += order.quantity;
        } else {
            actualsMap[key].actualThursdayQty += order.quantity;
        }
    });

    // 3. Compare and Save
    const batch = db.batch();
    forecastsSnap.forEach(doc => {
        const forecast = doc.data();
        const key = `${forecast.restaurantId}_${forecast.itemId}`;
        const actuals = actualsMap[key] || { actualMondayQty: 0, actualThursdayQty: 0, actualWeeklyQty: 0 };

        const varianceQty = actuals.actualWeeklyQty - forecast.predictedWeeklyQty;
        const variancePercent = forecast.predictedWeeklyQty > 0
            ? (varianceQty / forecast.predictedWeeklyQty) * 100
            : 0;

        let status = 'Accurate';
        if (variancePercent > 15) status = 'Under Forecast';
        if (variancePercent < -15) status = 'Over Forecast';

        const logRef = db.collection('forecastAccuracyLogs').doc(`${key}_${weekStartKey}`);
        batch.set(logRef, {
            weekStart: weekStartKey,
            restaurantId: forecast.restaurantId,
            itemId: forecast.itemId,
            predictedMondayQty: forecast.predictedMondayDeliveryQty,
            actualMondayQty: actuals.actualMondayQty,
            predictedThursdayQty: forecast.predictedThursdayDeliveryQty,
            actualThursdayQty: actuals.actualThursdayQty,
            predictedWeeklyQty: forecast.predictedWeeklyQty,
            actualWeeklyQty: actuals.actualWeeklyQty,
            varianceQty,
            variancePercent: parseFloat(variancePercent.toFixed(2)),
            status,
            confidenceAtForecastTime: forecast.confidence,
            wasEventAffected: forecast.isEventAffected || false,
            generatedAt: new Date().toISOString()
        });
    });

    await batch.commit();
    console.log(`Forecast accuracy recorded for week ${weekStartKey}.`);
}

module.exports = {
    checkForecastAccuracy
};
