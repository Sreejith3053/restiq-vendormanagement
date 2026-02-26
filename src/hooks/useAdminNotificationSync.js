import { useEffect, useRef, useContext } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, where, onSnapshot, doc, getDoc, setDoc, getDocs, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getTaxRate } from '../constants/taxRates';
import { UserContext } from '../contexts/UserContext';

// Module-level dedup guards — survive React StrictMode double-mount
const invoicedOrderIds = new Set();
const invoicedRestaurantOrderIds = new Set();

// Helper to create notifications idempotently
const createNotificationIfNotExists = async (notificationId, notificationData) => {
    try {
        const notifRef = doc(db, 'notifications', notificationId);
        const snap = await getDoc(notifRef);
        if (!snap.exists()) {
            await setDoc(notifRef, {
                ...notificationData,
                isRead: false,
                createdAt: serverTimestamp()
            });
        }
    } catch (err) {
        console.error('Failed to create notification:', err);
    }
};

const batchCreateNotifications = async (notifications) => {
    if (notifications.length === 0) return;
    try {
        const batch = writeBatch(db);
        for (const notif of notifications) {
            const notifRef = doc(db, 'notifications', notif.id);
            // In a real transactional system, we should check if they exist first, 
            // but for safety in frontend, we'll try to get them or just use setDoc with merge: true
            // merge: true ensures we don't overwrite if someone already marked it as read.
            // Wait, if it exists and we use merge: true, createdAt will update to serverTimestamp? 
            // No, we can just use setDoc without overwriting existing data if we query first.
            const snap = await getDoc(notifRef);
            if (!snap.exists()) {
                batch.set(notifRef, {
                    ...notif.data,
                    isRead: false,
                    createdAt: serverTimestamp()
                });
            }
        }
        await batch.commit();
    } catch (err) {
        console.error('Batch create notifications failed:', err);
    }
}

// Helper to generate a single invoice idempotently when an order is fulfilled
// Uses orderId as the document ID so duplicate writes are impossible
const generateInvoiceForOrder = async (order, invoiceBase) => {

    try {
        // Use deterministic doc ID = orderId. If it already exists, skip.
        const invRef = doc(db, 'vendorInvoices', order.id);
        const existingSnap = await getDoc(invRef);
        if (existingSnap.exists()) return;

        // 1. Check for Snapshotted Values
        const hasSnapshot = order.subtotalBeforeTax !== undefined;

        // Fetch Vendor for Commission % (and Legacy Tax)
        const vendorSnap = await getDoc(doc(db, 'vendors', order.vendorId));
        const vData = vendorSnap.exists() ? vendorSnap.data() : {};
        const vendorCommissionPercent = Number(vData.commissionPercent ?? 10);

        let subtotalVendorAmount = 0;
        let totalTaxAmount = 0;
        let formattedItems = [];

        if (hasSnapshot) {
            // BEST PATH: Use snapshot subtotal but recalculate tax per-item
            // to ensure only taxable items contribute to tax
            const taxRate = getTaxRate(vData.country || 'Canada', vData.province);
            subtotalVendorAmount = order.subtotalBeforeTax;
            formattedItems = (order.items || []).map(item => {
                const price = Number(item.vendorPrice ?? item.price ?? 0);
                const qty = item.qty || 1;
                const lineTotal = item.lineSubtotal || Number((price * qty).toFixed(2));
                const isTaxable = !!item.taxable;
                const lineTax = isTaxable ? Number((lineTotal * (taxRate / 100)).toFixed(2)) : 0;
                totalTaxAmount += lineTax;
                return {
                    itemId: item.itemId,
                    itemName: item.itemName || item.name || 'Unknown Item',
                    unit: item.unit || 'unit',
                    qty,
                    vendorPrice: price,
                    lineTotalVendor: lineTotal,
                    isTaxable,
                    lineTax
                };
            });
        } else {
            // LEGACY PATH: Fallback to dynamic lookup for old orders
            const taxRate = getTaxRate(vData.country || 'Canada', vData.province);

            const itemsRef = collection(db, `vendors/${order.vendorId}/items`);
            const itemsSnap = await getDocs(itemsRef);
            const itemTaxMap = {};
            itemsSnap.docs.forEach(d => {
                itemTaxMap[d.id] = !!d.data().taxable;
            });

            formattedItems = (order.items || []).map(item => {
                const price = Number(item.vendorPrice ?? item.price ?? 0);
                const qty = Number(item.qty || 1);
                const lineSubtotal = Number((price * qty).toFixed(2));

                const isTaxable = item.itemId ? itemTaxMap[item.itemId] : !!item.taxable;
                const lineTax = isTaxable ? Number((lineSubtotal * (taxRate / 100)).toFixed(2)) : 0;

                subtotalVendorAmount += lineSubtotal;
                totalTaxAmount += lineTax;

                return {
                    itemId: item.itemId,
                    itemName: item.itemName || item.name || 'Unknown Item',
                    unit: item.unit || 'unit',
                    qty,
                    vendorPrice: price,
                    lineTotalVendor: lineSubtotal,
                    isTaxable,
                    lineTax
                };
            });
        }

        const grossVendorAmount = Number(subtotalVendorAmount.toFixed(2));
        const commissionAmount = Number((grossVendorAmount * (vendorCommissionPercent / 100)).toFixed(2));
        const netVendorPayable = Number((grossVendorAmount - commissionAmount).toFixed(2));
        const totalVendorAmount = Number((subtotalVendorAmount + totalTaxAmount).toFixed(2)); // Legacy full amount
        const now = new Date();
        const invoiceNumber = `INV-V-${invoiceBase}`;

        // invRef already defined above with deterministic ID = order.id
        await setDoc(invRef, {
            orderId: order.id,
            orderGroupId: order.orderGroupId || order.id.slice(-8).toUpperCase(),
            vendorId: order.vendorId,
            restaurantId: order.restaurantId || 'Unknown Restaurant',
            invoiceNumber,
            invoiceDate: serverTimestamp(),
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            paymentStatus: 'PENDING',
            subtotalVendorAmount: grossVendorAmount,
            totalTaxAmount: Number(totalTaxAmount.toFixed(2)),
            totalVendorAmount: totalVendorAmount,
            grossVendorAmount,
            commissionPercent: vendorCommissionPercent,
            commissionAmount,
            netVendorPayable,
            commissionModel: 'VENDOR_FLAT_PERCENT',
            items: formattedItems,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            adminNotes: hasSnapshot ? 'Auto-generated (Snapshot)' : 'Auto-generated (Dynamic Fallback)'
        });

        // Cleanup: delete any stale duplicate invoices for this order (from old code with random IDs)
        try {
            const dupeQuery = query(collection(db, 'vendorInvoices'), where('orderId', '==', order.id));
            const dupeSnap = await getDocs(dupeQuery);
            dupeSnap.docs.forEach(async (d) => {
                if (d.id !== order.id) {
                    await deleteDoc(doc(db, 'vendorInvoices', d.id));
                }
            });
        } catch (cleanupErr) {
            console.error('Cleanup stale vendor invoices failed:', cleanupErr);
        }

    } catch (err) {
        console.error('Failed to generate vendor invoice automatically:', err);
    }
}

// Helper to generate a restaurant invoice (full amount, no commission deduction)
// Uses orderId as the document ID so duplicate writes are impossible
const generateRestaurantInvoiceForOrder = async (order, invoiceBase) => {
    try {
        const invRef = doc(db, 'restaurantInvoices', order.id);
        const existingSnap = await getDoc(invRef);
        if (existingSnap.exists()) return;

        // Fetch Vendor for tax rate
        const vendorSnap = await getDoc(doc(db, 'vendors', order.vendorId));
        const vData = vendorSnap.exists() ? vendorSnap.data() : {};
        const taxRate = getTaxRate(vData.country || 'Canada', vData.province);

        let subtotal = 0;
        let totalTax = 0;
        const formattedItems = (order.items || []).map(item => {
            const price = Number(item.vendorPrice ?? item.price ?? 0);
            const qty = item.qty || 1;
            const lineTotal = item.lineSubtotal || Number((price * qty).toFixed(2));
            const isTaxable = !!item.taxable;
            const lineTax = isTaxable ? Number((lineTotal * (taxRate / 100)).toFixed(2)) : 0;
            subtotal += lineTotal;
            totalTax += lineTax;
            return {
                itemId: item.itemId,
                itemName: item.itemName || item.name || 'Unknown Item',
                unit: item.unit || 'unit',
                qty,
                price,
                lineTotal,
                isTaxable,
                lineTax
            };
        });

        subtotal = Number(subtotal.toFixed(2));
        totalTax = Number(totalTax.toFixed(2));
        const grandTotal = Number((subtotal + totalTax).toFixed(2));
        const now = new Date();
        const invoiceNumber = `INV-C-${invoiceBase}`;

        await setDoc(invRef, {
            orderId: order.id,
            orderGroupId: order.orderGroupId || order.id.slice(-8).toUpperCase(),
            vendorId: order.vendorId,
            vendorName: order.vendorName || vData.name || 'Unknown Vendor',
            restaurantId: order.restaurantId || 'Unknown Restaurant',
            invoiceNumber,
            invoiceDate: serverTimestamp(),
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            paymentStatus: 'PENDING',
            subtotal,
            totalTax,
            grandTotal,
            items: formattedItems,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            adminNotes: 'Auto-generated for restaurant'
        });

    } catch (err) {
        console.error('Failed to generate restaurant invoice automatically:', err);
    }
}

export default function useAdminNotificationSync() {
    const { isSuperAdmin } = useContext(UserContext);
    const orderCache = useRef(new Map());
    const isInitialLoad = useRef(true);

    useEffect(() => {
        // Only Super Admins run the sync worker to prevent duplicate triggers from vendors
        if (!isSuperAdmin) return;

        // Query the most recent 100 orders to monitor. 
        // We use recent to avoid syncing the entire historical database on every load.
        // A Cloud Function is preferred in production.
        const q = query(collection(db, 'marketplaceOrders'), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            const newNotifications = [];

            for (const change of snapshot.docChanges()) {
                const order = { id: change.doc.id, ...change.doc.data() };
                const oldOrder = orderCache.current.get(order.id);

                // Update cache
                orderCache.current.set(order.id, order);

                const vendorId = order.vendorId;
                if (!vendorId) continue;

                // On initial load, we optionally create idempotency for NEW_ORDER 
                // but let's just observe real-time changes or obvious missing states.
                if (change.type === 'added') {
                    // Check if it's "recently" created (e.g. within last 24h) to generate NEW_ORDER if missing
                    const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                    const isRecent = createdAt && (Date.now() - createdAt.getTime()) < 24 * 60 * 60 * 1000;

                    if (isRecent && (order.status === 'new' || order.status === 'pending_confirmation')) {
                        // Idempotent generation for NEW_ORDER
                        const title = `New Order: ${order.id.slice(-8).toUpperCase()}`;
                        const message = `A new order has been placed by ${order.restaurantId || 'a customer'}.`;

                        newNotifications.push({
                            id: `${order.id}_NEW_ORDER_ADMIN`,
                            data: { orderId: order.id, type: 'NEW_ORDER', role: 'ADMIN', title, message }
                        });
                        newNotifications.push({
                            id: `${order.id}_NEW_ORDER_${vendorId}`,
                            data: { orderId: order.id, type: 'NEW_ORDER', role: 'VENDOR', vendorId, title, message }
                        });
                    }
                }

                if (change.type === 'modified' && oldOrder && !isInitialLoad.current) {
                    // Detect Status Change
                    if (oldOrder.status !== order.status) {
                        const isCancel = order.status === 'cancelled' || order.status === 'rejected';
                        const type = isCancel ? 'ORDER_CANCELLED' : 'STATUS_CHANGED';
                        const title = isCancel ? `Order Cancelled` : `Order Status Updated`;
                        const message = `Order ${order.id.slice(-8).toUpperCase()} is now ${order.status.replace(/_/g, ' ')}.`;

                        newNotifications.push({
                            id: `${order.id}_STATUS_${order.status}_ADMIN`,
                            data: { orderId: order.id, type, role: 'ADMIN', title, message }
                        });
                        newNotifications.push({
                            id: `${order.id}_STATUS_${order.status}_${vendorId}`,
                            data: { orderId: order.id, type, role: 'VENDOR', vendorId, title, message }
                        });

                        // Automatically generate invoices if status just changed to 'fulfilled'
                        if (order.status === 'fulfilled') {
                            const now = new Date();
                            const invoiceBase = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-5)}`;
                            // Vendor invoice
                            if (!invoicedOrderIds.has(order.id)) {
                                invoicedOrderIds.add(order.id);
                                generateInvoiceForOrder(order, invoiceBase);
                            }
                            // Restaurant invoice
                            if (!invoicedRestaurantOrderIds.has(order.id)) {
                                invoicedRestaurantOrderIds.add(order.id);
                                generateRestaurantInvoiceForOrder(order, invoiceBase);
                            }
                        }
                    }

                    // Detect Meaningful Updates (Totals changed or Items count changed)
                    const oldTotal = Number(oldOrder.total || 0);
                    const newTotal = Number(order.total || 0);
                    const oldItemsLen = oldOrder.items ? oldOrder.items.length : 0;
                    const newItemsLen = order.items ? order.items.length : 0;

                    if (oldTotal !== newTotal || oldItemsLen !== newItemsLen) {
                        // Generate a unique ID for this update using timestamp so multiple updates create multiple notifications
                        const updateTimestamp = Date.now();
                        const title = `Order Updated`;
                        const message = `Order ${order.id.slice(-8).toUpperCase()} has been modified (items or totals changed).`;

                        newNotifications.push({
                            id: `${order.id}_UPDATED_${updateTimestamp}_ADMIN`,
                            data: { orderId: order.id, type: 'ORDER_UPDATED', role: 'ADMIN', title, message }
                        });
                        newNotifications.push({
                            id: `${order.id}_UPDATED_${updateTimestamp}_${vendorId}`,
                            data: { orderId: order.id, type: 'ORDER_UPDATED', role: 'VENDOR', vendorId, title, message }
                        });
                    }
                }
            }

            if (isInitialLoad.current) {
                isInitialLoad.current = false;
            }

            if (newNotifications.length > 0) {
                await batchCreateNotifications(newNotifications);
            }
        });

        return () => unsubscribe();
    }, [isSuperAdmin]);
}
