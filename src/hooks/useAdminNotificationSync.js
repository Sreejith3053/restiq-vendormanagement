import { useEffect, useRef, useContext } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, doc, getDoc, setDoc, serverTimestamp, writeBatch, getDocs, where } from 'firebase/firestore';
import { getTaxRate } from '../constants/taxRates';
import { UserContext } from '../contexts/UserContext';

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
const generateInvoiceForOrder = async (order) => {
    try {
        const invQuery = query(collection(db, 'vendorInvoices'), where('orderId', '==', order.id));
        const invSnap = await getDocs(invQuery);
        if (!invSnap.empty) return;

        // 1. Check for Snapshotted Values
        const hasSnapshot = order.subtotalBeforeTax !== undefined;

        let subtotalVendorAmount = 0;
        let totalTaxAmount = 0;
        let formattedItems = [];

        if (hasSnapshot) {
            // BEST PATH: Use locked-in snapshot values
            subtotalVendorAmount = order.subtotalBeforeTax;
            totalTaxAmount = order.totalTax;
            formattedItems = (order.items || []).map(item => ({
                itemId: item.itemId,
                itemName: item.itemName || item.name || 'Unknown Item',
                unit: item.unit || 'unit',
                qty: item.qty || 1,
                vendorPrice: Number(item.vendorPrice ?? item.price ?? 0),
                lineTotalVendor: item.lineSubtotal || Number((item.vendorPrice ?? item.price ?? 0) * (item.qty || 1)),
                isTaxable: !!item.isTaxable,
                lineTax: item.lineTax || 0
            }));
        } else {
            // LEGACY PATH: Fallback to dynamic lookup for old orders
            const vendorSnap = await getDoc(doc(db, 'vendors', order.vendorId));
            const vData = vendorSnap.exists() ? vendorSnap.data() : {};
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

        const totalVendorAmount = Number((subtotalVendorAmount + totalTaxAmount).toFixed(2));
        const now = new Date();
        const invoiceNumber = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-5)}`;

        const invRef = doc(collection(db, 'vendorInvoices'));
        await setDoc(invRef, {
            orderId: order.id,
            vendorId: order.vendorId,
            restaurantId: order.restaurantId || 'Unknown Restaurant',
            invoiceNumber,
            invoiceDate: serverTimestamp(),
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            paymentStatus: 'PENDING',
            subtotalVendorAmount: Number(subtotalVendorAmount.toFixed(2)),
            totalTaxAmount: Number(totalTaxAmount.toFixed(2)),
            totalVendorAmount: totalVendorAmount,
            items: formattedItems,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            adminNotes: hasSnapshot ? 'Auto-generated (Snapshot)' : 'Auto-generated (Dynamic Fallback)'
        });

    } catch (err) {
        console.error('Failed to generate invoice automatically:', err);
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

                        // Automatically generate an invoice if status just changed to 'fulfilled'
                        if (order.status === 'fulfilled') {
                            generateInvoiceForOrder(order);
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
