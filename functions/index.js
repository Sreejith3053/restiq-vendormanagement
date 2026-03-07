const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const { runDeterministicForecast, aggregateForecasts, generateVendorRollups } = require("./forecastEngine");
const { checkForecastAccuracy } = require("./forecastAccuracy");

admin.initializeApp();
const db = getFirestore();

// 1. Weekly forecast generation job (Runs automatically Saturday night)
exports.weeklyForecastJob = onSchedule({
    schedule: "0 2 * * 0",
    secrets: ["GOOGLE_GENAI_API_KEY"]
}, async (event) => {
    console.log("Starting scheduled weekly forecast job...");
    await runDeterministicForecast(db);
    await aggregateForecasts(db);
    await generateVendorRollups(db);
});

// 2. Accuracy reconciliation job (Runs automatically Monday morning to check previous week)
exports.accuracyReconciliationJob = onSchedule({
    schedule: "0 4 * * 1",
    secrets: ["GOOGLE_GENAI_API_KEY"]
}, async (event) => {
    console.log("Starting scheduled accuracy reconciliation job...");
    await checkForecastAccuracy(db);
});

// Callable wrapper for Super Admin manual trigger from frontend
exports.triggerForecastEngine = onCall({
    secrets: ["GOOGLE_GENAI_API_KEY"]
}, async (request) => {
    // Basic auth check if needed
    if (!request.auth) {
        throw new Error("Unauthorized");
    }

    try {
        console.log("Manually triggered forecast engine...");
        await runDeterministicForecast(db);
        await aggregateForecasts(db);
        await generateVendorRollups(db);
        return { success: true, message: "Forecast generated successfully" };
    } catch (err) {
        console.error("Forecast Engine Error:", err);
        return { success: false, error: err.message };
    }
});
