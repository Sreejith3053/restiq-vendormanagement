/**
 * testSuggestedForecastJob.js
 *
 * Manual test script to run the suggested forecast job locally.
 * Usage: node functions/testSuggestedForecastJob.js
 *
 * Uses the same initialization pattern as runEngineLocal.js.
 */

const admin = require("firebase-admin");
const { runSuggestedForecastJob } = require("./suggestedForecastJob");

admin.initializeApp({
    projectId: 'restiq-vendormanagement'
});
const db = admin.firestore();

async function main() {
    console.log("=== Manual Test: Suggested Forecast Job ===\n");

    try {
        const result = await runSuggestedForecastJob(db);
        console.log("\n=== Result ===");
        console.log(JSON.stringify(result, null, 2));
        console.log("\n✅ Test complete!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Error running forecast job:", err);
        process.exit(1);
    }
}

main();
