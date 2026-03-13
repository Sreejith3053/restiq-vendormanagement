const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
// Legacy forecast engine modules removed (replaced by suggestedForecastJob)
// const { runDeterministicForecast, aggregateForecasts, generateVendorRollups } = require("./forecastEngine");
// const { checkForecastAccuracy } = require("./forecastAccuracy");
const { updateCatalogPrices } = require("./updatePrices");
const { sendOrderConfirmationEmail, SENDGRID_API_KEY, SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID } = require("./sendGridIntegration");
const { runSuggestedForecastJob } = require("./suggestedForecastJob");

const app = admin.initializeApp();
const db = getFirestore(app, "restiq-vendormanagement");

// Legacy forecast jobs — disabled (replaced by suggestedForecastJob)
// exports.weeklyForecastJob = onSchedule({ schedule: "0 2 * * 0" }, async () => { ... });
// exports.accuracyReconciliationJob = onSchedule({ schedule: "0 4 * * 1" }, async () => { ... });
// exports.forecastEngineQueueWorker = onSchedule("* * * * *", async () => { ... });

exports.triggerPriceUpdate = onCall(async (request) => {
    console.log("Triggering price ingestion batch script...");
    await updateCatalogPrices(db);
    return { success: true };
});

// 3. SendGrid Email - HTTPS Callable Function for Order Confirmation
// Called from the frontend after an order is accepted by a vendor.
exports.sendOrderConfirmationEmailFn = onCall({
    secrets: [SENDGRID_API_KEY, SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID]
}, async (request) => {
    // Log authentication status (non-blocking)
    if (!request.auth) {
        console.warn("Callable invoked without authentication context.");
    }

    const { orderId, toEmail, restaurantName } = request.data;
    if (!orderId) {
        throw new HttpsError("invalid-argument", "Missing orderId.");
    }

    console.log(`Sending order confirmation email for order: ${orderId} to: ${toEmail}`);

    try {
        // Fetch the order data from Firestore
        const orderSnap = await db.collection("marketplaceOrders").doc(orderId).get();
        if (!orderSnap.exists) {
            throw new HttpsError("not-found", `Order ${orderId} not found.`);
        }
        const orderData = { id: orderId, ...orderSnap.data() };
        console.log(`Order data keys: ${Object.keys(orderData).join(', ')}`);
        console.log(`Order vendorName: ${orderData.vendorName}, pickupDate: ${orderData.pickupDate}, items count: ${(orderData.items || []).length}`);

        // Send the email with the provided restaurant email and name
        const result = await sendOrderConfirmationEmail(orderData, toEmail, restaurantName);

        if (result) {
            return { success: true, message: `Confirmation email sent for order ${orderId}.` };
        } else {
            return { success: false, message: "Email sending failed. Check server logs." };
        }
    } catch (error) {
        console.error(`Failed to send confirmation email for ${orderId}:`, error);
        throw new HttpsError("internal", error.message || "Failed to send email.");
    }
});

// 4. Suggested Forecast Job — Runs every Wednesday at 6PM EST
//    Writes per-restaurant forecast data to `suggestedOrderAIForcast_Model` for RMS consumption
exports.suggestedForecastSchedule = onSchedule({
    schedule: "0 18 * * 3",
    timeZone: "America/New_York",
}, async () => {
    console.log("Starting scheduled suggested forecast job (Wednesday 6PM EST)...");
    await runSuggestedForecastJob(db);
});

// 5. Suggested Forecast — Manual trigger (callable from frontend)
exports.runSuggestedForecastNow = onCall(async (request) => {
    console.log("Manual trigger: running suggested forecast job...");
    try {
        const result = await runSuggestedForecastJob(db);
        return { success: true, ...result };
    } catch (err) {
        console.error("Manual forecast run failed:", err);
        throw new HttpsError("internal", err.message || "Forecast engine failed");
    }
});
