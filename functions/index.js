const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const { runDeterministicForecast, aggregateForecasts, generateVendorRollups } = require("./forecastEngine");
const { checkForecastAccuracy } = require("./forecastAccuracy");
const { sendOrderConfirmationEmail, SENDGRID_API_KEY, SENDGRID_ORDER_CONFIRMATION_TEMPLATE_ID } = require("./sendGridIntegration");

const app = admin.initializeApp();
const db = getFirestore(app, "restiq-vendormanagement");

// 1. Weekly forecast generation job (Runs automatically Saturday night)
exports.weeklyForecastJob = onSchedule({
    schedule: "0 2 * * 0"
}, async () => {
    console.log("Starting scheduled weekly forecast job...");
    await runDeterministicForecast(db);
    await aggregateForecasts(db);
    await generateVendorRollups(db);
});

// 2. Accuracy reconciliation job (Runs automatically Monday morning to check previous week)
exports.accuracyReconciliationJob = onSchedule({
    schedule: "0 4 * * 1"
}, async () => {
    console.log("Starting scheduled accuracy reconciliation job...");
    await checkForecastAccuracy(db);
});

// Cron job queue worker to bypass all HTTP and Eventarc enterprise restrictions
exports.forecastEngineQueueWorker = onSchedule("* * * * *", async () => {
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
