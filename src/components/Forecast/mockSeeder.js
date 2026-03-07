import { collection, doc, writeBatch, getDocs, deleteDoc } from 'firebase/firestore';

export async function runClientSideMockSeeder(db) {
    console.log("=== Starting Client-Side Mock Seeder ===");

    try {
        // 1. Wipe old mock data
        const collectionsToWipe = ['restaurantItemForecasts', 'aggregateItemForecasts', 'vendorPlanningForecasts', 'forecastAccuracyLogs'];
        for (const colName of collectionsToWipe) {
            const snap = await getDocs(collection(db, colName));
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
            console.log(`Wiped ${snap.size} docs from ${colName}`);
        }

        // 2. Generate new data inline
        const batch = writeBatch(db);

        // Date math
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7));
        const weekStartKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        // Config doc
        batch.set(doc(db, 'forecastConfig', 'global'), {
            safetyBufferPercent: 0.15,
            defaultMondaySplit: 0.40,
            defaultThursdaySplit: 0.60
        }, { merge: true });

        // Event doc
        batch.set(doc(db, 'festivalCalendar', 'mock-event-001'), {
            eventName: "Mock Spring Festival",
            startDate: new Date().toISOString().split('T')[0],
            endDate: weekStartKey,
            isActive: true,
            notes: "Test event injected via UI seeder",
            upliftRules: [
                { targetType: "category", targetValue: "Meat", percent: 20 }
            ]
        });

        // Mock Restaurant Forecast 1
        const r1Key = `test-rest-001_item-chicken-breast_${weekStartKey}`;
        batch.set(doc(db, 'restaurantItemForecasts', r1Key), {
            restaurantId: "test-rest-001",
            restaurantName: "The Great Mock Restaurant",
            itemId: "item-chicken-breast",
            itemName: "Premium Chicken Breast (10kg)",
            category: "Meat",
            unit: "Box",
            vendorId: "test-vendor-001",
            vendorName: "Premium Meats Co.",
            weekStart: weekStartKey,
            avgWeeklyQty: 25,
            predictedWeeklyQty: 30, // 25 + 20% uplift
            predictedMondayDeliveryQty: 12,
            predictedThursdayDeliveryQty: 18,
            mondaySplitPercent: 40,
            thursdaySplitPercent: 60,
            trend: "Increasing",
            confidence: "High",
            safetyBufferQty: 5,
            recommendedDispatchQty: 35,
            forecastReasoning: "Historical orders are increasing safely. Factored in a 20% uplift for the Mock Spring Festival.",
            isEventAffected: true,
            eventNamesApplied: ["Mock Spring Festival"],
            generatedAt: new Date().toISOString()
        });

        // Mock Aggregate Forecast
        const a1Key = `item-chicken-breast_${weekStartKey}`;
        batch.set(doc(db, 'aggregateItemForecasts', a1Key), {
            itemId: "item-chicken-breast",
            itemName: "Premium Chicken Breast (10kg)",
            category: "Meat",
            unit: "Box",
            vendorId: "test-vendor-001",
            vendorName: "Premium Meats Co.",
            totalPredictedWeeklyQty: 30,
            totalPredictedMondayDeliveryQty: 12,
            totalPredictedThursdayDeliveryQty: 18,
            restaurantsCount: 1,
            weekStart: weekStartKey,
            generatedAt: new Date().toISOString()
        });

        // Mock Vendor Planning Forecast
        const v1Key = `test-vendor-001_${weekStartKey}`;
        batch.set(doc(db, 'vendorPlanningForecasts', v1Key), {
            vendorId: "test-vendor-001",
            vendorName: "Premium Meats Co.",
            weekStart: weekStartKey,
            totalWeeklyDemand: 30,
            totalMondayDemand: 12,
            totalThursdayDemand: 18,
            itemForecasts: [{
                itemId: "item-chicken-breast",
                itemName: "Premium Chicken Breast (10kg)",
                totalPredictedWeeklyQty: 30,
                totalPredictedMondayDeliveryQty: 12,
                totalPredictedThursdayDeliveryQty: 18
            }],
            planningNotes: "Heavy Thursday prep required across meat categories due to upcoming Mock event.",
            generatedAt: new Date().toISOString()
        });

        // Mock Accuracy Log (Using previous week key)
        const prevWeekStart = new Date(d);
        prevWeekStart.setDate(prevWeekStart.getDate() - 7);
        const prevWeekKey = `${prevWeekStart.getFullYear()}-${String(prevWeekStart.getMonth() + 1).padStart(2, '0')}-${String(prevWeekStart.getDate()).padStart(2, '0')}`;

        const logKey = `test-rest-001_item-chicken-breast_${prevWeekKey}`;
        batch.set(doc(db, 'forecastAccuracyLogs', logKey), {
            weekStart: prevWeekKey,
            restaurantId: "test-rest-001",
            itemId: "item-chicken-breast",
            predictedMondayQty: 10,
            actualMondayQty: 10,
            predictedThursdayQty: 15,
            actualThursdayQty: 14,
            predictedWeeklyQty: 25,
            actualWeeklyQty: 24,
            varianceQty: -1,
            variancePercent: -4,
            status: "Accurate",
            confidenceAtForecastTime: "High",
            wasEventAffected: false,
            generatedAt: new Date().toISOString()
        });

        await batch.commit();
        console.log("=== Mock Seeding Complete! ===");
        alert("Mock Delivery Forecast data has been successfully injected! Please refresh the page.");
    } catch (err) {
        console.error("Seeding failed", err);
        alert("Seeding failed: " + err.message);
    }
}
