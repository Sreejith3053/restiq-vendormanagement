import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../../firebase';
import { doc, getDoc, updateDoc, collection, getDocs, addDoc, deleteDoc, serverTimestamp, query, where, orderBy } from 'firebase/firestore';
import { UserContext } from '../../contexts/UserContext';
import { toast } from 'react-toastify';
import EditItemModal from './EditItemModal';
import AddItemModal from './AddItemModal';
import ItemAnalyticsModal from './ItemAnalyticsModal';
import { COUNTRIES, getRegionsForCountry, getRegionLabel, getTaxRate } from '../../constants/taxRates';
import { formatPackSize, formatUnitPrice } from '../../utils/parseUnitInfo';
import { sendVendorItemToReviewQueue } from '../CatalogReview/reviewQueueService';

const ITEM_CATEGORIES = ['Spices', 'Meat', 'Produce', 'Dairy', 'Seafood', 'Grains', 'Beverages', 'Packaging', 'Cleaning', 'Other'];
const UNITS = ['kg', 'lb', 'g', 'oz', 'L', 'mL', 'unit', 'dozen', 'case', 'packet', 'bag', 'bundle', 'box'];


// ─── Price Normalization Engine ──────────────────────────────────────────────
//
// Firestore item schema (set by AddItemModal / vendorCatalogService):
//   unit:         "lb"      — sales unit label (dropdown selection)
//   packQuantity: 50        — numeric pack count (Number field)
//   itemSize:     "50lb"    — text description of pack size e.g. "50lb", "25lb"
//   baseUnit:     "lb"      — v2 canonical stripped unit (same as unit for weight)
//   vendorPrice:  19.80     — price per pack
//
// The display string "lb (50lb)" is constructed by formatItemSize() and is
// NEVER stored in Firestore. Do not try to parse it.
//
// enrichItem reads packQuantity and itemSize directly from the doc, then
// derives a unit price as: pricePerBaseUnit = vendorPrice / packQuantity
//
const enrichItem = (item) => {
    const rawUnitStr = (item.unit || item.baseUnit || item.orderUnit || '').trim();
    const price      = Number(item.vendorPrice ?? item.price ?? 0);
    const unitLower  = rawUnitStr.toLowerCase();
    const canonBase  = BASE_UNIT_CANONICAL[unitLower] || null;

    // ── STEP 1: Parenthetical parse on unit string (highest priority) ───────
    // Handles items where unit field contains "lb (50lb)" or "case (25lb)"  
    // (legacy data, CSV imports, or manual entry in unit field)
    const parenRx = rawUnitStr.match(/^([^(]+?)\s*\(\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*\)\s*$/);
    if (parenRx) {
        const salesLabel = parenRx[1].trim().toLowerCase();
        const qty        = parseFloat(parenRx[2]);
        const innerTok   = parenRx[3].trim().toLowerCase();
        const innerBase  = BASE_UNIT_CANONICAL[innerTok] || BASE_UNIT_CANONICAL[salesLabel] || null;
        if (qty > 0) {
            const bu   = innerBase || (innerTok ? null : BASE_UNIT_CANONICAL[salesLabel]) || 'unit';
            const norm = !!innerBase || !innerTok; // normalizable when base unit is known
            return _enrichResult(item, price, salesLabel, bu, qty, norm);
        }
    }

    // ── STEP 2: OPAQUE units — Normalizable ONLY when explicit weight/count info exists
    // Explicit info means: parenthetical caught in Step 1, OR packQuantity > 1,
    // OR itemSize string contains a weight quantity (e.g. "25lb", "10kg")
    if (OPAQUE_SET.has(unitLower)) {
        // a) itemSize string with a weight unit (e.g. "25lb", "10 kg")
        const { bu: sbu, qty: sqty } = _sizeInfo(item.itemSize, null);
        if (sqty && sbu) {
            return _enrichResult(item, price, unitLower, sbu, sqty, true);
        }
        // b) packQuantity explicitly > 1
        const pq = Number(item.packQuantity);
        if (!isNaN(pq) && pq > 1) {
            const { bu: psbu, qty: psqty } = _sizeInfo(item.itemSize, null);
            const effPack = psqty || pq;
            const effBase = psbu || 'unit';
            return _enrichResult(item, price, unitLower, effBase, effPack, true);
        }
        // c) No explicit size info — Raw Only
        return _enrichResult(item, price, unitLower, null, null, false);
    }

    // ── STEP 3: Weight/volume units  e.g. "lb", "kg" ─────────────────────
    if (WEIGHT_SET.has(unitLower) && canonBase) {
        // itemSize is CHECKED FIRST because packQuantity defaults to 1 for all items
        // (AddItemModal default), meaning packQuantity=1 is ambiguous — it could be
        // the default OR an actual single-unit item. itemSize is more explicit:
        //   itemSize="50lb" → packSize=50 regardless of packQuantity
        const { bu: sbu, qty: sqty } = _sizeInfo(item.itemSize, canonBase);
        if (sqty && sbu) return _enrichResult(item, price, unitLower, sbu, sqty, true);

        // itemSize has no numeric info — use packQuantity if it's > 1 (explicit)
        const pq = Number(item.packQuantity);
        if (!isNaN(pq) && pq > 1) {
            return _enrichResult(item, price, unitLower, canonBase, pq, true);
        }

        // packQuantity is 1 or missing — single unit item (e.g. 1 lb beet)
        return _enrichResult(item, price, unitLower, canonBase, 1, true);
    }

    // ── STEP 4: Scalar units  e.g. "unit", "each", "piece" ──────────────
    if (SCALAR_SET.has(unitLower)) {
        const pq = Number(item.packQuantity);
        const ps = (!isNaN(pq) && pq > 0) ? pq : 1;
        return _enrichResult(item, price, unitLower, 'unit', ps, true);
    }

    // ── STEP 5: Unknown / unclassified ──────────────────────────────────────
    return _enrichResult(item, price, unitLower || null, null, null, false);
};

// Module-level sets/maps (constructed once, not inside enrichItem)
const OPAQUE_SET = new Set(['bundle','bag','case','box','pack','packet','sleeve','tray','pail','bucket','dozen','can','jar','bottle','jug']);
const WEIGHT_SET = new Set(['kg','lb','g','oz','l','litre','liter','ml','milliliter','gal','gallon']);
const SCALAR_SET = new Set(['unit','each','ea','piece','pc','pcs','item','ct','count']);
const BASE_UNIT_CANONICAL = {
    kg:'kg', kilogram:'kg', kilograms:'kg',
    lb:'lb', lbs:'lb', pound:'lb', pounds:'lb',
    oz:'oz', ounce:'oz', ounces:'oz',
    g:'g',   gram:'g',  grams:'g',
    l:'L',   litre:'L', liter:'L', litres:'L', liters:'L',
    ml:'mL', milliliter:'mL', millilitre:'mL',
    gallon:'gal', gal:'gal',
};

// Return enriched item object; logs dev debug for known test items
function _enrichResult(item, price, salesUnit, baseUnit, packSize, normalizedPossible) {
    const ppbu = normalizedPossible && packSize && packSize > 0 ? price / packSize : null;
    if (process.env.NODE_ENV === 'development') {
        const debugNames = ['onion - cooking', 'onion - red', 'beets', 'long beans', 'celery', 'green onion', 'leeks', 'french beans'];
        const name = (item.itemName || item.name || '').toLowerCase();
        if (debugNames.some(n => name.includes(n))) {
            // eslint-disable-next-line no-console
            console.log(`[enrichItem] "${item.itemName||item.name}" unit="${item.unit}" pq=${item.packQuantity} sz="${item.itemSize}" → packSize=${packSize} base=${baseUnit} norm=${normalizedPossible} ppbu=${ppbu?.toFixed(4)??'null'}`);
        }
    }
    return { ...item, _salesUnit: salesUnit, _baseUnit: baseUnit, _packSize: packSize, _normalizedPossible: normalizedPossible, _pricePerBaseUnit: ppbu };
}

// Parse itemSize string like "50lb" → { bu:"lb", qty:50 }
function _sizeInfo(itemSize, fallbackBase) {
    if (!itemSize) return { bu: fallbackBase, qty: null };
    const m = String(itemSize).trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
    if (!m) return { bu: fallbackBase, qty: null };
    const qty = parseFloat(m[1]);
    const bu  = BASE_UNIT_CANONICAL[m[2].toLowerCase()] || fallbackBase || null;
    return { bu, qty: qty > 0 ? qty : null };
}


// Helper to format item size display
export const formatItemSize = (unit, packQty, size) => {
    let result = unit || '';
    if (packQty > 1 || size) {
        result += ' (';
        if (packQty > 1) result += `${packQty}`;
        if (packQty > 1 && size) result += ' x ';
        if (size) result += size;
        result += ')';
    }
    return result;
};

export default function VendorDetailPage() {
    const { vendorId: urlVendorId } = useParams();
    const navigate = useNavigate();
    const { role, vendorId: ctxVendorId, isSuperAdmin, isAdmin, userId, displayName, permissions } = useContext(UserContext);

    // Super admin uses URL param; vendor admin/user uses their context vendorId
    const vendorId = isSuperAdmin ? urlVendorId : ctxVendorId;

    const [vendor, setVendor] = useState(null);
    const [items, setItems] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('All');

    // Edit vendor
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({});

    // Add item modal
    const [itemModalOpen, setItemModalOpen] = useState(false);

    // Analytics Modal
    const [analyticsItem, setAnalyticsItem] = useState(null);

    // Edit item modal
    const [editingItem, setEditingItem] = useState(null);

    // Review UI state (super admin)
    const [reviewFilter, setReviewFilter] = useState('in-review');
    const [processingReviewId, setProcessingReviewId] = useState(null);
    const [rejectingId, setRejectingId] = useState(null);
    const [rejectComment, setRejectComment] = useState('');

    // Audit log viewer
    const [auditLogItemId, setAuditLogItemId] = useState(null);
    const [auditLogData, setAuditLogData] = useState([]);
    const [auditLogLoading, setAuditLogLoading] = useState(false);

    // Tab + Compare modal state (NEW)
    const [activeTab, setActiveTab] = useState('active'); // 'active' | 'pending' | 'rejected' | 'unmapped'
    const [compareItem, setCompareItem] = useState(null);  // item to compare cross-vendor
    const [compareData, setCompareData] = useState([]);    // [{vendorId, vendorName, price, unit, pricePerBaseUnit}]
    const [compareLoading, setCompareLoading] = useState(false);

    // Review queue integration state
    const [openReviewIds, setOpenReviewIds] = useState(new Set());
    const [sendingReviewId, setSendingReviewId] = useState(null);

    const canEdit = isSuperAdmin || isAdmin || (typeof permissions === 'object' && permissions?.canManageItems);
    const canEditProfile = isSuperAdmin || isAdmin || (typeof permissions === 'object' && permissions?.canEditProfile);

    // Audit log helper
    const logAudit = async (vid, itemId, action, details = {}) => {
        try {
            await addDoc(collection(db, `vendors/${vid}/items/${itemId}/auditLog`), {
                action,
                ...details,
                performedBy: userId,
                performedByName: displayName || 'Unknown',
                timestamp: serverTimestamp(),
            });
        } catch (err) {
            console.error('Audit log failed:', err);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                const vendorSnap = await getDoc(doc(db, 'vendors', vendorId));
                if (!vendorSnap.exists()) {
                    toast.error('Vendor not found');
                    navigate('/vendors');
                    return;
                }
                const vData = { id: vendorSnap.id, ...vendorSnap.data() };
                setVendor(vData);
                setEditForm(vData);

                // Load items
                // Load items, explicitly injecting vendorId and vendorName just in case the document lacks it
                const itemSnap = await getDocs(collection(db, `vendors/${vendorId}/items`));
                setItems(itemSnap.docs.map(d => ({
                    id: d.id,
                    vendorId: vendorId,
                    vendorName: vData.name,
                    ...d.data()
                })));

                // Load invoices
                if (isSuperAdmin) {
                    const invQ = query(
                        collection(db, 'vendorInvoices'),
                        where('vendorId', '==', vendorId)
                    );
                    const invSnap = await getDocs(invQ);
                    const invList = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                    // Sort descending by date locally
                    invList.sort((a, b) => {
                        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                        return dateB - dateA;
                    });
                    setInvoices(invList);
                }
            } catch (err) {
                console.error('Failed to load vendor:', err);
                toast.error('Failed to load vendor');
            } finally {
                setLoading(false);
            }
        })();
    }, [vendorId, navigate]);



    // Filter items
    const filteredItems = items.filter(item => {
        const matchSearch = !search ||
            (item.itemName || item.name || '').toLowerCase().includes(search.toLowerCase()) ||  // v2-first
            (item.sku || '').toLowerCase().includes(search.toLowerCase());
        const matchCat = categoryFilter === 'All' || item.category === categoryFilter;
        const matchStatus = statusFilter === 'All' || (item.status || 'active') === statusFilter;
        return matchSearch && matchCat && matchStatus;
    });

    // Save vendor edits
    const handleSaveVendor = async () => {
        try {
            const ref = doc(db, 'vendors', vendorId);
            const patch = {
                name: editForm.name?.trim() || '',
                category: editForm.category || '',
                country: editForm.country || 'Canada',
                province: editForm.province || '',
                contactName: editForm.contactName?.trim() || '',
                contactPhone: editForm.contactPhone?.trim() || '',
                contactEmail: editForm.contactEmail?.trim() || '',
                address: editForm.address?.trim() || '',
                notes: editForm.notes?.trim() || '',
                status: editForm.status || 'active',
                updatedAt: serverTimestamp(),
            };

            if (isSuperAdmin && editForm.commissionPercent !== undefined) {
                patch.commissionPercent = Number(editForm.commissionPercent) || 0;
                patch.commissionType = 'VENDOR_FLAT_PERCENT';
            }
            await updateDoc(ref, patch);
            setVendor(prev => ({ ...prev, ...patch }));
            setEditing(false);
            toast.success('Vendor updated!');
        } catch (err) {
            console.error(err);
            toast.error('Failed to update vendor');
        }
    };

    // Add item handling is now largely inside AddItemModal, but we need a callback 
    // to update the local list when an item is added.
    const handleItemAdded = (newItem) => {
        setItems(prev => [...prev, newItem]);
    };

    // Delete item — super admin deletes directly, vendor admin/user submits for review
    const handleDeleteItem = async (item) => {
        if (isSuperAdmin) {
            if (!window.confirm('Delete this item?')) return;
            try {
                await deleteDoc(doc(db, `vendors/${vendorId}/items`, item.id));
                setItems(prev => prev.filter(i => i.id !== item.id));
                toast.success('Item deleted');
            } catch (err) {
                console.error(err);
                toast.error('Failed to delete item');
            }
        } else {
            if (!window.confirm('Request deletion of this item? A super admin will review.')) return;
            try {
                const reviewFields = {
                    changeType: 'delete',
                    proposedData: null,
                    originalData: {
                        itemName:    item.itemName || item.name || '',  // Phase 3: v2-first
                        category:    item.category || '',
                        baseUnit:    item.baseUnit || item.unit || '',
                        vendorPrice: Number(item.vendorPrice ?? item.price ?? 0),
                        sku:         item.sku || '',
                        notes:       item.notes || '',
                    },
                    requestedBy: userId,
                    requestedByName: displayName || 'Unknown',
                    requestedAt: serverTimestamp(),
                };
                const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
                await updateDoc(itemRef, { status: 'in-review', ...reviewFields });
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'in-review', ...reviewFields } : i));
                await logAudit(vendorId, item.id, 'delete_requested', { itemName: item.name });
                toast.info('🗑️ Deletion request submitted for review!');
            } catch (err) {
                console.error(err);
                toast.error('Failed to submit deletion request');
            }
        }
    };

    // Handle item updated from edit modal
    const handleItemUpdated = (updatedItem) => {
        setItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i));
    };

    // ─── Review handlers (super admin) ───
    // "review" here is the item itself (which has review fields on it)
    const handleApproveReview = async (item) => {
        setProcessingReviewId(item.id);
        try {
            const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
            const clearFields = {
                status: 'active',
                rejectionComment: '',
                changeType: '',
                proposedData: null,
                originalData: null,
                requestedBy: '',
                requestedByName: '',
                requestedAt: null,
                updatedAt: serverTimestamp(),
            };

            if ((item.changeType === 'edit' || item.changeType === 'add') && item.proposedData) {
                await updateDoc(itemRef, { ...item.proposedData, ...clearFields });
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...item.proposedData, ...clearFields } : i));
            } else if (item.changeType === 'delete') {
                await deleteDoc(itemRef);
                setItems(prev => prev.filter(i => i.id !== item.id));
            }

            // Audit log
            if (item.changeType !== 'delete') {
                await logAudit(vendorId, item.id, 'approved', {
                itemName: item.proposedData?.itemName || item.proposedData?.name || item.itemName || item.name,  // v2-first
                proposedData: item.proposedData,
                originalData: item.originalData,
                requestedBy: item.requestedByName,
            });
            }
            toast.success(`✅ ${item.changeType === 'delete' ? 'Deletion' : item.changeType === 'add' ? 'New item' : 'Edit'} approved!`);
        } catch (err) {
            console.error('Error approving review:', err);
            toast.error('Failed to approve');
        } finally {
            setProcessingReviewId(null);
        }
    };

    const handleRejectReview = async (item) => {
        if (!rejectComment.trim()) {
            toast.warn('Please add a rejection comment.');
            return;
        }
        setProcessingReviewId(item.id);
        try {
            const itemRef = doc(db, `vendors/${vendorId}/items`, item.id);
            if (item.changeType === 'add') {
                // Rejecting a new item → remove it entirely
                await deleteDoc(itemRef);
                setItems(prev => prev.filter(i => i.id !== item.id));
            } else {
                await updateDoc(itemRef, {
                    status: 'rejected',
                    rejectionComment: rejectComment.trim(),
                    changeType: '',
                    proposedData: null,
                    originalData: null,
                });
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'rejected', rejectionComment: rejectComment.trim(), changeType: '', proposedData: null, originalData: null } : i));
            }
            setRejectingId(null);
            setRejectComment('');
            // Audit log
            if (item.changeType !== 'add') {
                await logAudit(vendorId, item.id, 'rejected', {
                    itemName: item.name,
                    rejectionComment: rejectComment.trim(),
                    requestedBy: item.requestedByName,
                });
            }
            toast.info('❌ Change request rejected.');
        } catch (err) {
            console.error('Error rejecting review:', err);
            toast.error('Failed to reject');
        } finally {
            setProcessingReviewId(null);
        }
    };

    const formatReviewDate = (ts) => {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // Derive review items from items list (items with non-active status that have review data)
    const reviewItems = items.filter(i => i.status === 'in-review' || i.status === 'rejected');
    const filteredReviewItems = reviewFilter === 'all' ? reviewItems : reviewItems.filter(i => i.status === reviewFilter);
    const inReviewCount = items.filter(i => i.status === 'in-review').length;

    // Load audit log for a specific item
    const toggleAuditLog = async (itemId) => {
        if (auditLogItemId === itemId) {
            setAuditLogItemId(null);
            setAuditLogData([]);
            return;
        }
        setAuditLogItemId(itemId);
        setAuditLogLoading(true);
        try {
            const snap = await getDocs(collection(db, `vendors/${vendorId}/items/${itemId}/auditLog`));
            const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            logs.sort((a, b) => {
                const tA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
                const tB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
                return tB - tA;
            });
            setAuditLogData(logs);
        } catch (err) {
            console.error('Failed to load audit log:', err);
            setAuditLogData([]);
        } finally {
            setAuditLogLoading(false);
        }
    };

    const formatAuditAction = (action) => {
        const map = {
            'created': '🆕 Created',
            'created_pending': '🆕 New Item (Pending Review)',
            'edited_direct': '✏️ Edited (Direct)',
            'edit_requested': '📩 Edit Submitted for Review',
            'approved': '✅ Approved',
            'rejected': '❌ Rejected',
            'delete_requested': '🗑️ Delete Requested',
            'deleted': '❌ Deleted',
            'delete_approved': '✅ Delete Approved',
        };
        return map[action] || action;
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading vendor...</div>;
    }

    if (!vendor) return null;

    // Unique categories from loaded items for filter
    const itemCategories = ['All', ...new Set(items.map(i => i.category).filter(Boolean))];

    // ─── Enrich items with computed price fields ───
    const enrichedItems = items.map(enrichItem);

    // ─── Vendor Intelligence Stats (always derived from FULL enriched list) ───
    // Status values in Firestore may be capitalized ('Active', 'In Review', 'Rejected')
    // from vendorCatalogService.js — always normalize to lowercase before comparing.
    // Unknown/missing statuses go to 'unknown' bucket instead of silently becoming Active.
    const getItemStatus = (item) => {
        // Union strategy: check BOTH status fields.
        // Any non-active workflow value in either field wins over 'active'.
        // This prevents normalizedStatus='active' (from Phase 1 import) from hiding
        // a subsequent status='in-review' set by the review workflow.
        const s1 = (item.normalizedStatus || '').toLowerCase().trim();
        const s2 = (item.status || '').toLowerCase().trim();
        const PENDING_VALS = ['in-review', 'in review', 'in_review', 'needs-correction', 'needs correction', 'pending', 'pending review', 'review_flagged', 'pending_review'];

        // Rejected in either field → rejected
        if (s1 === 'rejected' || s2 === 'rejected') return 'rejected';
        // Pending/review in either field → pending
        if (PENDING_VALS.includes(s1) || PENDING_VALS.includes(s2)) return 'pending';
        // Active in either field → active (only reached when no non-active value found)
        if (s1 === 'active' || s2 === 'active') return 'active';
        // Both empty → truly unknown
        if (!s1 && !s2) return 'unknown';
        return 'unknown';
    };

    const activeItems   = enrichedItems.filter(i => getItemStatus(i) === 'active');
    const pendingItems  = enrichedItems.filter(i => getItemStatus(i) === 'pending');
    const rejectedItems = enrichedItems.filter(i => getItemStatus(i) === 'rejected');
    const unknownItems  = enrichedItems.filter(i => getItemStatus(i) === 'unknown');
    const unmappedItems = enrichedItems.filter(i => !i.catalogItemId);

    // avgUnitPrice: compute SEPARATELY per base unit to avoid mixing /lb and /unit
    const normalizedActive = activeItems.filter(i => i._normalizedPossible && i._pricePerBaseUnit !== null && i._pricePerBaseUnit > 0);
    const lbItems   = normalizedActive.filter(i => i._baseUnit === 'lb');
    const kgItems   = normalizedActive.filter(i => i._baseUnit === 'kg');
    const unitItems = normalizedActive.filter(i => i._baseUnit === 'unit');
    const avg = (arr) => arr.length ? arr.reduce((s, i) => s + i._pricePerBaseUnit, 0) / arr.length : null;
    const avgLb   = avg(lbItems);
    const avgKg   = avg(kgItems);
    const avgUnit = avg(unitItems);

    // Duplicate detection: flag items whose normalized names are very similar
    const normalizeName = (n) => (n || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokenSort     = (n) => normalizeName(n).split(' ').sort().join(' ');
    const nameSortedMap = {};
    enrichedItems.forEach(i => {
        const key = tokenSort(i.itemName || i.name || '');
        if (!nameSortedMap[key]) nameSortedMap[key] = [];
        nameSortedMap[key].push(i.id);
    });
    const duplicateSets = new Set(
        Object.values(nameSortedMap).filter(ids => ids.length > 1).flat()
    );

    // Price highlight thresholds (only normalizable items)
    const activePrices = normalizedActive.map(i => i._pricePerBaseUnit);
    const minUnitPrice = activePrices.length ? Math.min(...activePrices) : null;
    const maxUnitPrice = activePrices.length ? Math.max(...activePrices) : null;

    // Tab → filtered item list
    const tabItems = {
        active:   activeItems,
        pending:  [...pendingItems, ...unknownItems],
        rejected: rejectedItems,
        unmapped: unmappedItems,
        unknown:  unknownItems,
    }[activeTab] || activeItems;

    // Apply search + category filter on top of tab
    const filteredTabItems = tabItems.filter(item => {
        const matchSearch = !search ||
            (item.itemName || item.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (item.sku || '').toLowerCase().includes(search.toLowerCase());
        const matchCat = categoryFilter === 'All' || item.category === categoryFilter;
        return matchSearch && matchCat;
    });

    // ─── Send to Review Queue (replaces simple flag logic) ───

    const handleSendToReview = async (item) => {
        // Determine issue flags automatically
        const flags = [];
        if (duplicateSets.has(item.id)) flags.push('possible_alias');
        if (item._normalizedPossible && item._packSize === 1 && item._baseUnit === 'lb' && item._pricePerBaseUnit > 10) flags.push('suspect_entry');
        if (!item._normalizedPossible) flags.push('raw_only');
        if (!item.catalogItemId) flags.push('unmapped_item');
        const primaryReason = flags[0] || 'data_quality';

        setSendingReviewId(item.id);
        try {
            const result = await sendVendorItemToReviewQueue({
                vendorId,
                vendorName: vendor?.name || '',
                vendorItemId: item.id,
                item,
                issueFlags: flags,
                primaryReason,
                reviewedBy: { userId: userId || '', displayName: displayName || '' },
            });

            // Update local state: mark item as review_flagged and track in openReviewIds
            setItems(prev => prev.map(i =>
                i.id === item.id
                    ? { ...i, status: 'review_flagged', normalizedStatus: 'review_flagged', reviewQueueId: result.reviewId }
                    : i
            ));
            setOpenReviewIds(prev => new Set([...prev, item.id]));

            toast.success(
                result.isUpdate
                    ? `"${item.itemName || item.name}" review record updated.`
                    : `"${item.itemName || item.name}" sent to review queue.`
            );
        } catch (err) {
            console.error('Send to review failed:', err);
            toast.error('Failed to send item to review');
        } finally {
            setSendingReviewId(null);
        }
    };

    // ─── Cross-vendor compare handler ───
    const handleCompare = async (item) => {
        if (!item.catalogItemId) {
            toast.info('This item has no catalog link — cannot compare across vendors yet.');
            return;
        }
        setCompareItem(item);
        setCompareLoading(true);
        setCompareData([]);
        try {
            const vendorsSnap = await getDocs(collection(db, 'vendors'));
            const results = [];
            for (const vDoc of vendorsSnap.docs) {
                const itemsSnap = await getDocs(collection(db, `vendors/${vDoc.id}/items`));
                itemsSnap.docs.forEach(d => {
                    const data = d.data();
                    if (data.catalogItemId === item.catalogItemId) {
                        const enriched = enrichItem({ id: d.id, ...data });
                        results.push({
                            vendorId:         vDoc.id,
                            vendorName:       vDoc.data().name || vDoc.id,
                            price:            Number(data.vendorPrice ?? data.price ?? 0),
                            unit:             data.baseUnit || data.unit || '—',
                            packSize:         enriched._packSize,
                            pricePerBaseUnit: enriched._pricePerBaseUnit,
                            baseUnit:         enriched._baseUnit,
                            isCurrentVendor:  vDoc.id === vendorId,
                        });
                    }
                });
            }
            results.sort((a, b) => a.pricePerBaseUnit - b.pricePerBaseUnit);
            setCompareData(results);
        } catch (err) {
            console.error('Compare failed:', err);
            toast.error('Failed to load comparison data');
        } finally {
            setCompareLoading(false);
        }
    };

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <h2>{vendor.name}</h2>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button className="ui-btn ghost" onClick={() => navigate(isSuperAdmin ? '/vendors' : '/')}>← Back</button>
                </div>
            </div>

            {/* Vendor Profile Section */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Business Details</h3>
                {canEditProfile && !editing && (
                    <button className="ui-btn small" onClick={() => setEditing(true)}>✏️ Edit Profile</button>
                )}
            </div>

            <div className="ui-card" style={{ marginBottom: 32 }}>
                {editing ? (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
                            <div><label className="ui-label">Name</label><input className="ui-input" value={editForm.name || ''} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
                            <div><label className="ui-label">Category</label>
                                <select className="ui-input" value={editForm.category || ''} onChange={e => setEditForm(p => ({ ...p, category: e.target.value }))}>
                                    <option value="">Select...</option>
                                    {ITEM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div><label className="ui-label">Country</label>
                                <select className="ui-input" value={editForm.country || 'Canada'} onChange={e => setEditForm(p => ({ ...p, country: e.target.value, province: '' }))}>
                                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div><label className="ui-label">{getRegionLabel(editForm.country || 'Canada')}</label>
                                <select className="ui-input" value={editForm.province || ''} onChange={e => setEditForm(p => ({ ...p, province: e.target.value }))}>
                                    <option value="">Select...</option>
                                    {getRegionsForCountry(editForm.country || 'Canada').map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                                </select>
                            </div>
                            <div><label className="ui-label">Contact Name</label><input className="ui-input" value={editForm.contactName || ''} onChange={e => setEditForm(p => ({ ...p, contactName: e.target.value }))} /></div>
                            <div><label className="ui-label">Phone</label><input className="ui-input" value={editForm.contactPhone || ''} onChange={e => setEditForm(p => ({ ...p, contactPhone: e.target.value }))} /></div>
                            <div><label className="ui-label">Email</label><input className="ui-input" value={editForm.contactEmail || ''} onChange={e => setEditForm(p => ({ ...p, contactEmail: e.target.value }))} /></div>
                            <div><label className="ui-label">Status</label>
                                <select className="ui-input" value={editForm.status || 'active'} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                            {isSuperAdmin && (
                                <div><label className="ui-label">Commission %</label>
                                    <input className="ui-input" type="number" min="0" max="100" step="0.1" value={editForm.commissionPercent ?? 10} onChange={e => setEditForm(p => ({ ...p, commissionPercent: e.target.value }))} />
                                </div>
                            )}
                        </div>
                        <div style={{ marginTop: 16 }}><label className="ui-label">Address</label><input className="ui-input" value={editForm.address || ''} onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))} /></div>
                        <div style={{ marginTop: 16 }}><label className="ui-label">Notes</label><textarea className="ui-input" style={{ height: 60 }} value={editForm.notes || ''} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} /></div>
                        {editForm.province && (
                            <div style={{ marginTop: 12 }}>
                                <span className="badge green" style={{ fontSize: 13 }}>Tax Rate: {getTaxRate(editForm.country || 'Canada', editForm.province)}%</span>
                            </div>
                        )}
                        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button className="ui-btn ghost" onClick={() => { setEditing(false); setEditForm(vendor); }}>Cancel</button>
                            <button className="ui-btn primary" onClick={handleSaveVendor}>💾 Save</button>
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                        <div><span className="muted small">Category</span><div><span className="badge blue">{vendor.category || 'General'}</span></div></div>
                        <div><span className="muted small">Country</span><div>{vendor.country || '—'}</div></div>
                        <div><span className="muted small">{getRegionLabel(vendor.country || 'Canada')}</span><div>{(() => { const r = getRegionsForCountry(vendor.country || 'Canada').find(r => r.code === vendor.province); return r ? r.name : vendor.province || '—'; })()}</div></div>
                        <div><span className="muted small">Tax Rate</span><div><span className="badge green">{vendor.province ? `${getTaxRate(vendor.country || 'Canada', vendor.province)}%` : '—'}</span></div></div>
                        <div><span className="muted small">Contact</span><div>{vendor.contactName || '—'}</div></div>
                        <div><span className="muted small">Phone</span><div>{vendor.contactPhone || '—'}</div></div>
                        <div><span className="muted small">Email</span><div>{vendor.contactEmail || '—'}</div></div>
                        <div><span className="muted small">Address</span><div>{vendor.address || '—'}</div></div>
                        <div><span className="muted small">Status</span><div><span className={`badge ${vendor.status === 'inactive' ? 'red' : 'green'}`}>{vendor.status || 'active'}</span></div></div>
                        {isSuperAdmin && (
                            <div><span className="muted small">Commission %</span><div><span className="badge amber">{vendor.commissionPercent !== undefined ? `${vendor.commissionPercent}%` : '10% (Default)'}</span></div></div>
                        )}
                        {vendor.notes && <div style={{ gridColumn: '1 / -1' }}><span className="muted small">Notes</span><div>{vendor.notes}</div></div>}
                    </div>
                )}
            </div>

            {/* ── Vendor Intelligence Panel ── */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
                marginBottom: 24,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 12,
                padding: '16px 20px',
            }}>
                {[
                    { label: 'Total Items',    value: enrichedItems.length,                                          icon: '📦' },
                    { label: 'Active',              value: activeItems.length,                                            icon: '✅', color: '#4ade80' },
                    // Pending Vendor Items = distinct vendor items awaiting admin approval (not total review queue actions)
                    { label: 'Pending Vendor Items', value: pendingItems.length + unknownItems.length,                     icon: '🕐', color: '#fbbf24' },
                    { label: 'Rejected',             value: rejectedItems.length,                                          icon: '❌', color: '#f87171' },
                    { label: 'Avg /lb',        value: avgLb   !== null ? `$${avgLb.toFixed(3)}/lb`   : '—',          icon: '⚖️', color: '#818cf8' },
                    { label: 'Avg /unit',      value: avgUnit  !== null ? `$${avgUnit.toFixed(3)}/unit` : '—',        icon: '🔢', color: '#818cf8' },
                ].map(({ label, value, icon, color }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
                    </div>
                ))}
            </div>

            {/* Items Section Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Items ({filteredTabItems.length}{filteredTabItems.length !== items.length ? ` of ${items.length}` : ''})</h3>
                {canEdit && (
                    <button className="ui-btn primary small" onClick={() => setItemModalOpen(true)}>
                        + Add Item
                    </button>
                )}
            </div>

            {/* ── Tab Bar ── */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
                {([
                    { key: 'active',   label: 'Active',         count: activeItems.length,                      color: '#4ade80' },
                    // Pending Vendor Items = distinct items awaiting approval (may differ from Review Queue total)
                    { key: 'pending',  label: 'Pending Vendor Items', count: pendingItems.length + unknownItems.length, color: '#fbbf24' },
                    { key: 'rejected', label: 'Rejected',       count: rejectedItems.length,                    color: '#f87171' },
                    { key: 'unmapped', label: 'Unmapped',       count: unmappedItems.length,                    color: '#94a3b8' },
                    ...(unknownItems.length > 0 ? [{ key: 'unknown', label: '⚠️ Unknown Status', count: unknownItems.length, color: '#f59e0b' }] : []),
                ]).map(({ key, label, count, color }) => (
                    <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        style={{
                            padding: '6px 14px',
                            borderRadius: 7,
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 13,
                            fontWeight: activeTab === key ? 700 : 400,
                            background: activeTab === key ? 'rgba(255,255,255,0.1)' : 'transparent',
                            color: activeTab === key ? color : 'var(--text-secondary)',
                            transition: 'all 0.15s',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}
                    >
                        {label}
                        <span style={{
                            background: activeTab === key ? color : 'rgba(255,255,255,0.08)',
                            color: activeTab === key ? '#000' : 'var(--text-secondary)',
                            borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 700,
                        }}>{count}</span>
                    </button>
                ))}
            </div>

            {/* ── Search + Category filter ── */}
            {items.length > 0 && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    <input
                        className="ui-input"
                        placeholder="🔍  Search items or SKU..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ maxWidth: 300, flex: 1 }}
                    />
                    <select
                        className="ui-input"
                        value={categoryFilter}
                        onChange={e => setCategoryFilter(e.target.value)}
                        style={{ maxWidth: 180 }}
                    >
                        {itemCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
            )}

            {/* ── Badge Legend ── */}
            {items.length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10, alignItems:'center' }}>
                    <span style={{ fontSize:10, color:'var(--text-secondary)', marginRight:2 }}>Legend:</span>
                    {[
                        { label:'Normalized',     bg:'rgba(74,222,128,0.15)',  color:'#4ade80', bd:'rgba(74,222,128,0.3)' },
                        { label:'Raw Only',       bg:'rgba(148,163,184,0.15)',color:'#94a3b8', bd:'rgba(148,163,184,0.2)' },
                        { label:'Possible Alias', bg:'rgba(251,191,36,0.15)', color:'#fbbf24', bd:'rgba(251,191,36,0.3)' },
                        { label:'⚠ Suspect Entry',bg:'rgba(248,113,113,0.15)',color:'#f87171', bd:'rgba(248,113,113,0.3)' },
                    ].map(({ label, bg, color, bd }) => (
                        <span key={label} style={{ fontSize:9, fontWeight:600, padding:'2px 7px', borderRadius:4, background:bg, color, border:`1px solid ${bd}` }}>
                            {label}
                        </span>
                    ))}
                </div>
            )}

            {
                items.length === 0 ? (
                    <div className="ui-card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                        No items yet. {canEdit && <span style={{ color: 'var(--accent-1)', cursor: 'pointer' }} onClick={() => setItemModalOpen(true)}>Add the first item →</span>}
                    </div>
                ) : filteredTabItems.length === 0 ? (
                    <div className="ui-card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                        No items match your filters.
                    </div>
                ) : (
                    <div className="ui-table-wrap">
                        <table className="ui-table">
                            <thead>
                                <tr>
                                    <th>Item Name</th>
                                    <th>Category</th>
                                    <th>Unit</th>
                                    <th>Pack Size</th>
                                    <th>Price</th>
                                    <th>Unit Price</th>
                                    <th>Market Rank</th>
                                    <th>Price Trend</th>
                                    <th>Tax</th>
                                    <th>SKU</th>
                                    <th>Status</th>
                                    <th>Analytics</th>
                                    {canEdit && <th>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTabItems.map(item => {
                                    const itemStatus = getItemStatus(item);   // 'active' | 'pending' | 'rejected' | 'unknown'
                                    const statusColor = itemStatus === 'active' ? 'green' : (itemStatus === 'pending') ? 'yellow' : itemStatus === 'rejected' ? 'red' : 'orange';
                                    const statusLabel = itemStatus === 'active' ? 'Active' : itemStatus === 'pending' ? 'In Review' : itemStatus === 'rejected' ? 'Rejected' : (item.status || 'Unknown');
                                    // Price highlight logic (only when both items are normalizable)
                                    const isCheapest  = item._normalizedPossible && minUnitPrice !== null && item._pricePerBaseUnit !== null && Math.abs(item._pricePerBaseUnit - minUnitPrice) < 0.00001 && activePrices.length > 1;
                                    const isMostExp   = item._normalizedPossible && maxUnitPrice !== null && item._pricePerBaseUnit !== null && Math.abs(item._pricePerBaseUnit - maxUnitPrice) < 0.00001 && activePrices.length > 1;
                                    const unitPriceColor = isCheapest ? '#4ade80' : isMostExp ? '#f87171' : 'var(--text-primary)';
                                    const unitPriceDisplay = item._normalizedPossible && item._pricePerBaseUnit !== null
                                        ? formatUnitPrice(Number(item.vendorPrice ?? item.price ?? 0), item._packSize, item._baseUnit)
                                        : null;
                                    const packSizeDisplay = item._normalizedPossible && item._packSize !== null
                                        ? formatPackSize(item._packSize, item._baseUnit)
                                        : '—';
                                    return (
                                        <React.Fragment key={item.id}>
                                            <tr className="is-row" onClick={() => navigate(`/vendors/${vendorId}/items/${item.id}`)} style={{ cursor: 'pointer' }}>
                                                <td data-label="Name" style={{ fontWeight: 600, color: '#4dabf7' }}>
                                                    {item.itemName || item.name}
                                                    {(itemStatus === 'rejected' || itemStatus === 'needs-correction') && item.rejectionComment && (
                                                        <div style={{ fontSize: 11, color: itemStatus === 'rejected' ? '#ff6b7a' : '#f59e0b', fontWeight: 400, marginTop: 4, background: itemStatus === 'rejected' ? 'rgba(255,107,122,0.1)' : 'rgba(245,158,11,0.1)', padding: '4px 8px', borderRadius: 4 }}>
                                                            {itemStatus === 'rejected' ? '❌' : '⚠️'} {item.rejectionComment}
                                                        </div>
                                                    )}
                                                    {/* Normalization badge */}
                                                    <span style={{
                                                        display: 'inline-block',
                                                        marginLeft: 6,
                                                        fontSize: 9,
                                                        fontWeight: 600,
                                                        padding: '1px 5px',
                                                        borderRadius: 4,
                                                        verticalAlign: 'middle',
                                                        background: item._normalizedPossible ? 'rgba(74,222,128,0.15)' : 'rgba(148,163,184,0.15)',
                                                        color: item._normalizedPossible ? '#4ade80' : '#94a3b8',
                                                        border: `1px solid ${item._normalizedPossible ? 'rgba(74,222,128,0.3)' : 'rgba(148,163,184,0.2)'}`,
                                                    }}>
                                                        {item._normalizedPossible ? 'Normalized' : 'Raw Only'}
                                                    </span>
                                                    {/* Duplicate / alias badge */}
                                                    {duplicateSets.has(item.id) && (
                                                        <span style={{ display:'inline-block', marginLeft:4, fontSize:9, fontWeight:600, padding:'1px 5px', borderRadius:4, verticalAlign:'middle', background:'rgba(251,191,36,0.15)', color:'#fbbf24', border:'1px solid rgba(251,191,36,0.3)' }}>
                                                            Possible Alias
                                                        </span>
                                                    )}
                                                    {/* Price anomaly badge — high per-unit price on small-pack produce */}
                                                    {item._normalizedPossible && item._packSize === 1 && item._baseUnit === 'lb' && item._pricePerBaseUnit > 10 && (
                                                        <span title="Price seems high for a single lb — was a pack price entered as a per-lb price?" style={{ display:'inline-block', marginLeft:4, fontSize:9, fontWeight:600, padding:'1px 5px', borderRadius:4, verticalAlign:'middle', background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)', cursor:'help' }}>
                                                            ⚠ Suspect Entry
                                                        </span>
                                                    )}
                                                </td>
                                                <td data-label="Category"><span className="badge blue">{item.category || '—'}</span></td>
                                                <td data-label="Unit" style={{ textTransform: 'capitalize' }}>
                                                    {formatItemSize(item.baseUnit || item.unit, item.packQuantity, item.itemSize)}
                                                </td>
                                                <td data-label="Pack Size" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                                                    {packSizeDisplay}
                                                </td>
                                                <td data-label="Price">${Number(item.vendorPrice ?? item.price ?? 0).toFixed(2)}</td>
                                                <td data-label="Unit Price" style={{ fontWeight: 600, color: unitPriceColor }}>
                                                    {unitPriceDisplay !== null ? (
                                                        <>
                                                            {unitPriceDisplay}
                                                            {isCheapest && <span title="Cheapest unit price"> 🏆</span>}
                                                            {isMostExp  && <span title="Most expensive unit price"> ⚠️</span>}
                                                        </>
                                                    ) : '—'}
                                                </td>
                                                <td data-label="Market Rank" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>— <span style={{ opacity: 0.4 }}>(soon)</span></td>
                                                <td data-label="Price Trend"  style={{ color: 'var(--text-secondary)', fontSize: 12 }}>— <span style={{ opacity: 0.4 }}>(soon)</span></td>
                                                <td data-label="Tax">
                                                    {item.taxable ? <span style={{ color: '#f59e0b', fontWeight: 600 }}>13%</span> : <span style={{ color: 'var(--muted)' }}>—</span>}
                                                </td>
                                                <td data-label="SKU">{item.sku || '—'}</td>
                                                <td data-label="Status"><span className={`badge ${statusColor}`}>{statusLabel}</span></td>
                                                <td data-label="Analytics" onClick={e => e.stopPropagation()}>
                                                    <button className="ui-btn small ghost" onClick={() => setAnalyticsItem(item)} title="View Analytics">📊 Analytics</button>
                                                </td>
                                                {canEdit && (
                                                    <td onClick={e => e.stopPropagation()}>
                                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                            <button className="ui-btn mini" onClick={() => setEditingItem(item)}>✏️</button>
                                                            <button className="ui-btn mini danger" onClick={() => handleDeleteItem(item)}>🗑️</button>
                                                            <button className={`ui-btn mini ${auditLogItemId === item.id ? 'primary' : 'ghost'}`} onClick={() => toggleAuditLog(item.id)} title="View History">📜</button>
                                                            <button className="ui-btn mini ghost" onClick={() => handleCompare(item)} title="Compare across vendors">⚖️</button>
                                                            {/* Send to Review / In Review indicator */}
                                                            {(() => {
                                                                const isInReview = openReviewIds.has(item.id) || getItemStatus(item) === 'pending';
                                                                const hasIssue = duplicateSets.has(item.id) || (item._normalizedPossible && item._packSize === 1 && item._baseUnit === 'lb' && item._pricePerBaseUnit > 10) || !item._normalizedPossible || !item.catalogItemId;
                                                                if (isInReview) return (
                                                                    <span style={{ fontSize:9, fontWeight:600, padding:'2px 6px', borderRadius:4, background:'rgba(251,191,36,0.15)', color:'#fbbf24', border:'1px solid rgba(251,191,36,0.3)', whiteSpace:'nowrap' }}>
                                                                        🔍 In Review
                                                                    </span>
                                                                );
                                                                if (hasIssue) return (
                                                                    <button
                                                                        className="ui-btn mini ghost"
                                                                        title="Send to review queue"
                                                                        onClick={() => handleSendToReview(item)}
                                                                        disabled={sendingReviewId === item.id}
                                                                        style={{ color:'#f59e0b', borderColor:'rgba(245,158,11,0.3)', whiteSpace:'nowrap', fontSize:10 }}
                                                                    >
                                                                        {sendingReviewId === item.id ? '⏳' : '🚩 Review'}
                                                                    </button>
                                                                );
                                                                return null;
                                                            })()}
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                            {/* Expandable audit log */}
                                            {auditLogItemId === item.id && (
                                                <tr>
                                                    <td colSpan={canEdit ? 11 : 10} style={{ padding: 0 }}>
                                                        <div style={{ background: 'rgba(0,200,255,0.03)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px' }}>
                                                            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>📜 History for {item.itemName || item.name}</div>
                                                            {auditLogLoading ? (
                                                                <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading...</div>
                                                            ) : auditLogData.length === 0 ? (
                                                                <div style={{ color: 'var(--muted)', fontSize: 12 }}>No audit history yet.</div>
                                                            ) : (
                                                                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                                                                    {auditLogData.map(log => (
                                                                        <div key={log.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13 }}>
                                                                            <div style={{ minWidth: 170, color: 'var(--muted)', fontSize: 11 }}>
                                                                                {formatReviewDate(log.timestamp)}
                                                                            </div>
                                                                            <div style={{ flex: 1 }}>
                                                                                <div>
                                                                                    <span style={{ fontWeight: 600 }}>{formatAuditAction(log.action)}</span>
                                                                                    <span style={{ color: 'var(--muted)', marginLeft: 8 }}>by {log.performedByName}</span>
                                                                                </div>
                                                                                {log.rejectionComment && (
                                                                                    <div style={{ fontSize: 11, color: '#ff6b7a', marginTop: 2 }}>💬 {log.rejectionComment}</div>
                                                                                )}
                                                                                {log.proposedData && (
                                                                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                                                                        Changes: {Object.keys(log.proposedData).filter(k => {
                                                                                            const orig = log.originalData ? String(log.originalData[k] ?? '') : '';
                                                                                            return String(log.proposedData[k] ?? '') !== orig;
                                                                                        }).map(k => (
                                                                                            <span key={k} style={{ marginRight: 8 }}>
                                                                                                <strong>{k}</strong>: {log.originalData ? `${log.originalData[k]} → ` : ''}{log.proposedData[k]}
                                                                                            </span>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            }

            {/* ── Compare Modal ── */}
            {compareItem && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} onClick={() => setCompareItem(null)}>
                    <div style={{
                        background: 'var(--bg-card, #1a1b2e)', borderRadius: 16, padding: 28,
                        minWidth: 420, maxWidth: 640, width: '90%', maxHeight: '80vh',
                        overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 17 }}>⚖️ Cross-Vendor Compare</div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>{compareItem.itemName || compareItem.name}</div>
                            </div>
                            <button className="ui-btn mini ghost" onClick={() => setCompareItem(null)}>✕</button>
                        </div>

                        {compareLoading ? (
                            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>Loading vendors…</div>
                        ) : compareData.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                                No other vendors carry this item yet (catalogItemId matched 0 vendors).
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                        <th style={{ textAlign: 'left', padding: '6px 8px' }}>Vendor</th>
                                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Price</th>
                                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Unit</th>
                                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Pack</th>
                                        <th style={{ textAlign: 'right', padding: '6px 8px' }}>Unit Price</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {compareData.map((row, idx) => {
                                        const isBest  = idx === 0;
                                        const isWorst = idx === compareData.length - 1 && compareData.length > 1;
                                        return (
                                            <tr key={row.vendorId} style={{
                                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                background: row.isCurrentVendor ? 'rgba(255,255,255,0.04)' : 'transparent',
                                            }}>
                                                <td style={{ padding: '8px 8px', fontWeight: row.isCurrentVendor ? 700 : 400 }}>
                                                    {row.vendorName}
                                                    {row.isCurrentVendor && <span style={{ fontSize: 10, color: '#818cf8', marginLeft: 6 }}>← this vendor</span>}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '8px 8px' }}>${row.price.toFixed(2)}</td>
                                                <td style={{ textAlign: 'right', padding: '8px 8px', color: 'var(--text-secondary)' }}>{row.unit}</td>
                                                <td style={{ textAlign: 'right', padding: '8px 8px', color: 'var(--text-secondary)' }}>{row.packSize > 1 ? `${row.packSize} ${row.baseUnit}` : '—'}</td>
                                                <td style={{ textAlign: 'right', padding: '8px 8px', fontWeight: 700, color: isBest ? '#4ade80' : isWorst ? '#f87171' : 'var(--text-primary)' }}>
                                                    ${row.pricePerBaseUnit.toFixed(3)}/{row.baseUnit}
                                                    {isBest  && <span title="Cheapest"> 🏆</span>}
                                                    {isWorst && <span title="Most expensive"> ⚠️</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
                            AI price prediction and savings engine coming soon
                        </div>
                    </div>
                </div>
            )}

            {/* Add Item Modal */}
            {itemModalOpen && (
                <AddItemModal
                    vendorId={vendorId}
                    isSuperAdmin={isSuperAdmin}
                    userId={userId}
                    displayName={displayName}
                    onClose={() => setItemModalOpen(false)}
                    onItemAdded={handleItemAdded}
                    logAudit={logAudit}
                />
            )}

            {/* Analytics Modal */}
            {analyticsItem && (
                <ItemAnalyticsModal
                    item={{ ...analyticsItem, vendorName: vendor?.name }}
                    onClose={() => setAnalyticsItem(null)}
                />
            )}

            {/* Edit Item Modal */}
            {
                editingItem && (
                    <EditItemModal
                        item={editingItem}
                        vendorId={vendorId}
                        vendorName={vendor?.name}
                        onClose={() => setEditingItem(null)}
                        onItemUpdated={handleItemUpdated}
                        logAudit={logAudit}
                    />
                )
            }




            {/* ── Vendor Invoices Section (Super Admin Only) ── */}
            {isSuperAdmin && (
                <div style={{ marginTop: 40, marginBottom: 40 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <h3 style={{ margin: 0 }}>Vendor Invoices</h3>
                        <button className="ui-btn ghost small" onClick={() => navigate(`/admin/invoices?vendor=${vendorId}`)}>Manage All →</button>
                    </div>

                    {invoices.length === 0 ? (
                        <div className="ui-card" style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                            No invoices generated for this vendor yet.
                        </div>
                    ) : (
                        <div className="ui-table-wrap">
                            <table className="ui-table">
                                <thead>
                                    <tr>
                                        <th>Invoice #</th>
                                        <th>Date</th>
                                        <th>Order ID</th>
                                        <th style={{ textAlign: 'right' }}>Gross Amount</th>
                                        <th style={{ textAlign: 'right' }}>Commission</th>
                                        <th style={{ textAlign: 'right' }}>Net Payout</th>
                                        <th style={{ textAlign: 'center' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.slice(0, 50).map(inv => {
                                        const dateLabel = formatReviewDate(inv.createdAt);
                                        const gross = Number(inv.subtotalVendorAmount || 0) + Number(inv.taxAmount || 0);
                                        const commission = Number(inv.commissionAmount || 0);
                                        const net = Number(inv.totalVendorAmount || gross - commission);

                                        return (
                                            <tr key={inv.id} className="is-row" onClick={() => navigate(`/admin/invoices/${inv.id}`)}>
                                                <td style={{ fontWeight: 600 }}>{inv.invoiceNumber || '—'}</td>
                                                <td>{dateLabel}</td>
                                                <td style={{ color: 'var(--muted)' }}>{inv.orderId || '—'}</td>
                                                <td style={{ textAlign: 'right' }}>${gross.toFixed(2)}</td>
                                                <td style={{ textAlign: 'right', color: '#ff6b7a' }}>-${commission.toFixed(2)}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#4ade80' }}>${net.toFixed(2)}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span className={`badge ${inv.paymentStatus === 'PAID' ? 'green' : 'yellow'}`}>
                                                        {inv.paymentStatus || 'PENDING'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {invoices.length > 50 && (
                                <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 13 }}>
                                    Showing latest 50 invoices. Click "Manage All" to view the rest.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
