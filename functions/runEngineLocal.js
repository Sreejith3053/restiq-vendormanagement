const admin = require("firebase-admin");
const { runDeterministicForecast, aggregateForecasts, generateVendorRollups } = require("./forecastEngine");

admin.initializeApp({
    projectId: 'restiq-vendormanagement'
});
const db = admin.firestore();

async function runLocal() {
    try {
        console.log("Locally triggering forecast engine...");
        await runDeterministicForecast(db);
        await aggregateForecasts(db);
        await generateVendorRollups(db);
        console.log("✅ Forecast generated successfully!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Forecast Engine Error:", err);
        process.exit(1);
    }
}

runLocal();
