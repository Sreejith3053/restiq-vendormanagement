/**
 * migrateRestaurants.js
 *
 * Enhanced migration: Scans marketplaceOrders + submittedOrders to collect
 * unique restaurant IDs/names, creates restaurant documents in `restaurants`,
 * and logs the migration to `migrationLogs`.
 *
 * SAFE: Only creates documents where missing. Never overwrites. Idempotent.
 */
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { generateRestaurantId } from './catalogUtils';

const BATCH_SIZE = 20; // process in batches to avoid rate limits

/**
 * Run the restaurant migration.
 * @param {Function} onProgress - callback(msg) for live progress updates
 * @returns {{ created, skipped, errors, restaurants }}
 */
export async function migrateRestaurants(onProgress) {
    const log = { created: 0, skipped: 0, errors: [], restaurants: [] };
    const startTime = new Date();

    try {
        // 1. Scan marketplaceOrders for unique restaurants
        if (onProgress) onProgress('Scanning marketplaceOrders...');
        const ordersSnap = await getDocs(collection(db, 'marketplaceOrders'));
        const restMap = {}; // restaurantId → { name, count, latestDate }

        ordersSnap.docs.forEach(d => {
            const order = d.data();
            const rid = order.restaurantId;
            const rname = order.restaurantName || order.restaurantId || '';
            if (!rid) return;

            const ts = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(0);

            if (!restMap[rid]) {
                restMap[rid] = { id: rid, name: rname, orderCount: 0, latestDate: ts };
            }
            restMap[rid].orderCount++;
            // Keep the most recent non-empty name
            if (rname && ts >= restMap[rid].latestDate) {
                restMap[rid].name = rname;
                restMap[rid].latestDate = ts;
            }
        });

        // 2. Also scan submittedOrders
        if (onProgress) onProgress('Scanning submittedOrders...');
        const subSnap = await getDocs(collection(db, 'submittedOrders'));
        subSnap.docs.forEach(d => {
            const order = d.data();
            const rid = order.restaurantId;
            const rname = order.restaurantName || order.restaurantId || '';
            if (!rid) return;

            const ts = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(0);

            if (!restMap[rid]) {
                restMap[rid] = { id: rid, name: rname, orderCount: 0, latestDate: ts };
            }
            restMap[rid].orderCount++;
            if (rname && ts >= restMap[rid].latestDate) {
                restMap[rid].name = rname;
                restMap[rid].latestDate = ts;
            }
        });

        const restaurants = Object.values(restMap);
        if (onProgress) onProgress(`Found ${restaurants.length} unique restaurants. Processing in batches of ${BATCH_SIZE}...`);

        // 3. Process in batches
        for (let i = 0; i < restaurants.length; i += BATCH_SIZE) {
            const batch = restaurants.slice(i, i + BATCH_SIZE);
            if (onProgress) onProgress(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(restaurants.length / BATCH_SIZE)}...`);

            for (const rest of batch) {
                const restId = rest.id || generateRestaurantId(rest.name);
                try {
                    // Idempotent: skip if already exists
                    const existing = await getDoc(doc(db, 'restaurants', restId));
                    if (existing.exists()) {
                        log.skipped++;
                        log.restaurants.push({ id: restId, name: rest.name, status: 'skipped', reason: 'already exists' });
                        continue;
                    }

                    // Create new restaurant document with minimum fields
                    const restDoc = {
                        restaurantId: restId,
                        name: rest.name || restId,
                        code: restId.replace(/_/g, '-'),
                        branchType: 'restaurant',
                        status: 'active',
                        phone: '',
                        email: '',
                        addressLine1: '',
                        city: '',
                        province: 'ON',
                        postalCode: '',
                        deliveryDays: [],
                        forecastEnabled: true,
                        subscriptionPlan: 'marketplace-basic',
                        notes: `Auto-created from ${rest.orderCount} orders during migration`,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    };

                    await setDoc(doc(db, 'restaurants', restId), restDoc);
                    log.created++;
                    log.restaurants.push({ id: restId, name: rest.name, status: 'created' });
                    if (onProgress) onProgress(`✓ Created: ${rest.name} (${restId})`);
                } catch (err) {
                    log.errors.push(`${rest.name}: ${err.message}`);
                    log.restaurants.push({ id: restId, name: rest.name, status: 'error', error: err.message });
                }
            }
        }

        // 4. Write migration log
        try {
            await addDoc(collection(db, 'migrationLogs'), {
                type: 'restaurantsBackfill',
                startedAt: startTime.toISOString(),
                completedAt: new Date().toISOString(),
                status: log.errors.length === 0 ? 'completed' : 'completed_with_errors',
                totalProcessed: restaurants.length,
                totalCreated: log.created,
                totalUpdated: 0,
                totalSkipped: log.skipped,
                totalNeedsReview: 0,
                errorCount: log.errors.length,
                notes: `Scanned ${ordersSnap.docs.length} marketplaceOrders + ${subSnap.docs.length} submittedOrders`,
                createdAt: serverTimestamp(),
            });
        } catch (logErr) {
            console.warn('Migration log write failed:', logErr);
        }

        if (onProgress) onProgress(`✅ Done. Created: ${log.created}, Skipped: ${log.skipped}, Errors: ${log.errors.length}`);
    } catch (err) {
        log.errors.push(`Fatal: ${err.message}`);
        if (onProgress) onProgress(`❌ Fatal error: ${err.message}`);
    }

    return log;
}
