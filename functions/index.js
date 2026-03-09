const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const { runDeterministicForecast, aggregateForecasts, generateVendorRollups } = require("./forecastEngine");
const { checkForecastAccuracy } = require("./forecastAccuracy");
const { updateCatalogPrices } = require("./updatePrices");
const { onCall } = require("firebase-functions/v2/https");

const app = admin.initializeApp();
const db = getFirestore(app, "restiq-vendormanagement");

// 1. Weekly forecast generation job (Runs automatically Saturday night)
exports.weeklyForecastJob = onSchedule({
    schedule: "0 2 * * 0"
}, async (event) => {
    console.log("Starting scheduled weekly forecast job...");
    await runDeterministicForecast(db);
    await aggregateForecasts(db);
    await generateVendorRollups(db);
});

// 2. Accuracy reconciliation job (Runs automatically Monday morning to check previous week)
exports.accuracyReconciliationJob = onSchedule({
    schedule: "0 4 * * 1"
}, async (event) => {
    console.log("Starting scheduled accuracy reconciliation job...");
    await checkForecastAccuracy(db);
});

// Cron job queue worker to bypass all HTTP and Eventarc enterprise restrictions
exports.forecastEngineQueueWorker = onSchedule("* * * * *", async (event) => {
    try {
        const pendingRef = db.collection('engineTriggers').where('status', '==', 'pending').limit(1);
        const snapshot = await pendingRef.get();

        if (snapshot.empty) {
            return { success: true, message: "No pending triggers." };
        }

        const docSnap = snapshot.docs[0];
        console.log("Processing pending forecast engine trigger:", docSnap.id);

        await docSnap.ref.update({ status: 'processing' });

        await runDeterministicForecast(db);
        await aggregateForecasts(db);
        await generateVendorRollups(db);

        await docSnap.ref.update({
            status: 'completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };
    } catch (err) {
        console.error("Forecast Engine Queue Worker Error:", err);
        // Attempt to mark as error if we have a doc context, otherwise just fail gracefully
        try {
            const pendingRef = db.collection('engineTriggers').where('status', '==', 'processing').limit(1);
            const snapshot = await pendingRef.get();
            if (!snapshot.empty) {
                await snapshot.docs[0].ref.update({
                    status: 'error',
                    error: err.message,
                    completedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (e) { } // ignore fallback error
        return { success: false, error: err.message };
    }
});

exports.triggerPriceUpdate = onCall(async (request) => {
    console.log("Triggering price ingestion batch script...");
    await updateCatalogPrices(db);
    return { success: true };
});
