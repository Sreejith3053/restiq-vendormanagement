// src/App.js
import React, { useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UserContext } from './contexts/UserContext';
import Login from './components/Login';
import ForcePasswordChange from './components/ForcePasswordChange';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import PrivateRoute from './components/PrivateRoute';

// ── Consolidated Pages (SuperAdmin) ─────────────────────────────────
import OrdersFulfillmentPage from './components/Consolidated/OrdersFulfillmentPage';
import VendorsPage from './components/Consolidated/VendorsPage';
import CatalogReviewsPage from './components/Consolidated/CatalogReviewsPage';
import IntelligencePage from './components/Consolidated/IntelligencePage';
import FinancePage from './components/Consolidated/FinancePage';
import PlatformAdminPage from './components/Consolidated/PlatformAdminPage';

// ── Detail / Sub-pages (remain standalone) ──────────────────────────
import VendorDetailPage from './components/Vendors/VendorDetailPage';
import ItemDetailPage from './components/Vendors/ItemDetailPage';
import AdminRestaurantDetailPage from './components/Admin/AdminRestaurantDetailPage';
import RestaurantInvoiceDetailPage from './components/Admin/RestaurantInvoiceDetailPage';
import InvoiceDetailPage from './components/Vendors/InvoiceDetailPage';

// ── Vendor / Non-SuperAdmin Pages ───────────────────────────────────
import Dashboard from './components/Dashboard';
import ItemCatalogPage from './components/Vendors/ItemCatalogPage';
import DispatchRequestsPage from './components/Vendors/DispatchRequestsPage';
import DispatchDetailPage from './components/Vendors/DispatchDetailPage';
import VendorInvoicesPage from './components/Vendors/VendorInvoicesPage';
import VendorScoreDashboard from './components/Vendors/VendorScoreDashboard';
import VendorExpectedAllocation from './components/Vendors/VendorExpectedAllocation';
import VendorCapacityPlanning from './components/Vendors/VendorCapacityPlanning';
import VendorImportPage from './components/BulkImport/VendorImportPage';
import VendorImportPreviewPage from './components/BulkImport/VendorImportPreviewPage';
import VendorImportHistoryPage from './components/BulkImport/VendorImportHistoryPage';
import UserManagementPage from './components/Users/UserManagementPage';
import RolePermissionsPage from './components/Settings/RolePermissionsPage';
import VendorIssuesSection from './components/Vendors/VendorIssuesSection';
import VendorNotificationCenter from './components/Vendors/VendorNotificationCenter';
import VendorAnalytics from './components/Vendors/VendorAnalytics';
import VendorAvailabilityCalendar from './components/Vendors/VendorAvailabilityCalendar';

// ── Control Tower ───────────────────────────────────────────────────
import GlobalSupplyControlTower from './components/Forecast/GlobalSupplyControlTower';

// ── Forecast Module (SuperAdmin — kept for internal tabs / CT) ──────
import ForecastOverviewPage from './components/Forecast/ForecastOverviewPage';
import RestaurantForecastPage from './components/Forecast/RestaurantForecastPage';
import CombinedDemandPage from './components/Forecast/CombinedDemandPage';
import VendorPlanningPage from './components/Forecast/VendorPlanningPage';
import ForecastAccuracyPage from './components/Forecast/ForecastAccuracyPage';
import ForecastAlertsPage from './components/Forecast/ForecastAlertsPage';
import ForecastSettingsPage from './components/Forecast/ForecastSettingsPage';
import DemandForecastPage from './components/Forecast/DemandForecastPage';
import ForecastIntelligencePage from './components/Forecast/ForecastIntelligencePage';
import WarehousePickListPage from './components/Forecast/WarehousePickListPage';
import SuggestedOrderReview from './components/Forecast/SuggestedOrderReview';

// ── Admin Notification Sync ─────────────────────────────────────────
import useAdminNotificationSync from './hooks/useAdminNotificationSync';
import SuperAdminDashboard from './components/Admin/SuperAdminDashboard';

// ── 404 page ────────────────────────────────────────────────────────
import NotFoundPage from './components/NotFoundPage';

// ── Toasts ──────────────────────────────────────────────────────────
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
    const { role, isSuperAdmin, authLoading, user } = useContext(UserContext);
    const navigate = useNavigate();
    const location = useLocation();

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    const isAdmin = normalizedRole === 'admin';
    const isAuthenticated = !!role;

    useAdminNotificationSync();

    const [showSidebar, setShowSidebar] = useState(false);

    // Persist last path for UX convenience (non-sensitive — just a URL)
    useEffect(() => {
        if (normalizedRole) sessionStorage.setItem('vm_lastPath', location.pathname);
    }, [location.pathname, normalizedRole]);

    // Close sidebar on route change (mobile)
    useEffect(() => {
        if (window.innerWidth < 1024) setShowSidebar(false);
    }, [location.pathname]);

    // While Firebase Auth is resolving, show a minimal loader (avoids redirect flash)
    if (authLoading) {
        return (
            <div style={{ background: '#0f1923', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ color: '#4a9eff', fontSize: 14 }}>Loading RestIQ…</div>
            </div>
        );
    }

    // Not authenticated — show login
    if (!isAuthenticated) {
        return <Login />;
    }

    // Force password change on first login
    if (user?.mustChangePassword && location.pathname !== '/change-password') {
        return <ForcePasswordChange />;
    }

    return (
        <ErrorBoundary>
        <div className="app-container theme-neon">
            <Sidebar isOpen={showSidebar} onClose={() => setShowSidebar(false)} />

            <div className="main-content">
                <TopBar onMenuClick={() => setShowSidebar(true)} />

                <div className="page-content">
                    <Routes>
                        <Route path="/login" element={<Navigate to={isSuperAdmin ? "/admin/forecast/control-tower" : "/"} />} />
                        <Route path="/change-password" element={<ForcePasswordChange />} />

                        {/* ══════════════════════════════════════════════════════════
                            SUPER ADMIN ROUTES — guarded by PrivateRoute
                           ══════════════════════════════════════════════════════════ */}
                        {isSuperAdmin && (
                            <>
                                {/* ── 1. Control Tower (unchanged) ── */}
                                <Route path="/admin/forecast/control-tower" element={
                                    <PrivateRoute requiredRole="superadmin"><GlobalSupplyControlTower /></PrivateRoute>
                                } />
                                <Route path="/admin/dashboard" element={
                                    <PrivateRoute requiredRole="superadmin"><SuperAdminDashboard /></PrivateRoute>
                                } />
                                <Route path="/" element={<Navigate to="/admin/forecast/control-tower" />} />

                                {/* ── 2. Orders & Fulfillment (consolidated) ── */}
                                <Route path="/orders-fulfillment" element={
                                    <PrivateRoute requiredRole="superadmin"><OrdersFulfillmentPage /></PrivateRoute>
                                } />

                                {/* ── 3. Vendors (consolidated) ── */}
                                <Route path="/vendors" element={
                                    <PrivateRoute requiredRole="superadmin"><VendorsPage /></PrivateRoute>
                                } />
                                <Route path="/vendors/:vendorId" element={
                                    <PrivateRoute requiredRole="superadmin"><VendorDetailPage /></PrivateRoute>
                                } />
                                <Route path="/vendors/:vendorId/items/:itemId" element={
                                    <PrivateRoute requiredRole="superadmin"><ItemDetailPage /></PrivateRoute>
                                } />

                                {/* ── 4. Catalog & Reviews (consolidated) ── */}
                                <Route path="/catalog-reviews" element={
                                    <PrivateRoute requiredRole="superadmin"><CatalogReviewsPage /></PrivateRoute>
                                } />

                                {/* ── 5. Intelligence (consolidated) ── */}
                                <Route path="/intelligence" element={
                                    <PrivateRoute requiredRole="superadmin"><IntelligencePage /></PrivateRoute>
                                } />

                                {/* ── 6. Finance (consolidated) ── */}
                                <Route path="/finance" element={
                                    <PrivateRoute requiredRole="superadmin"><FinancePage /></PrivateRoute>
                                } />
                                <Route path="/admin/restaurant-invoices/:invoiceId" element={
                                    <PrivateRoute requiredRole="superadmin"><RestaurantInvoiceDetailPage /></PrivateRoute>
                                } />
                                <Route path="/admin/invoices/:invoiceId" element={
                                    <PrivateRoute requiredRole="superadmin"><InvoiceDetailPage /></PrivateRoute>
                                } />

                                {/* ── 7. Platform Admin (consolidated) ── */}
                                <Route path="/platform-admin" element={
                                    <PrivateRoute requiredRole="superadmin"><PlatformAdminPage /></PrivateRoute>
                                } />
                                <Route path="/admin/restaurants/:restaurantId" element={
                                    <PrivateRoute requiredRole="superadmin"><AdminRestaurantDetailPage /></PrivateRoute>
                                } />

                                {/* ── Forecast internal routes (used by CT tabs) ── */}
                                <Route path="/admin/forecast/demand" element={<PrivateRoute requiredRole="superadmin"><DemandForecastPage /></PrivateRoute>} />
                                <Route path="/admin/forecast/intelligence" element={<PrivateRoute requiredRole="superadmin"><ForecastIntelligencePage /></PrivateRoute>} />
                                <Route path="/admin/forecast/restaurants" element={<PrivateRoute requiredRole="superadmin"><RestaurantForecastPage /></PrivateRoute>} />
                                <Route path="/admin/forecast/combined" element={<PrivateRoute requiredRole="superadmin"><CombinedDemandPage /></PrivateRoute>} />
                                <Route path="/admin/forecast/vendors" element={<PrivateRoute requiredRole="superadmin"><VendorPlanningPage /></PrivateRoute>} />
                                <Route path="/admin/forecast/accuracy" element={<PrivateRoute requiredRole="superadmin"><ForecastAccuracyPage /></PrivateRoute>} />
                                <Route path="/admin/forecast/alerts" element={<PrivateRoute requiredRole="superadmin"><ForecastAlertsPage /></PrivateRoute>} />
                                <Route path="/admin/forecast/settings" element={<PrivateRoute requiredRole="superadmin"><ForecastSettingsPage /></PrivateRoute>} />
                                <Route path="/admin/dispatch/warehouse" element={<PrivateRoute requiredRole="superadmin"><WarehousePickListPage /></PrivateRoute>} />
                                <Route path="/admin/forecast/suggested-order-review" element={<PrivateRoute requiredRole="superadmin"><SuggestedOrderReview /></PrivateRoute>} />

                                {/* ═══════════════════════════════════════════════════
                                    LEGACY ROUTE REDIRECTS
                                    All old routes safely redirect to consolidated pages.
                                    This preserves bookmarks and existing links.
                                   ═══════════════════════════════════════════════════ */}

                                {/* Orders & Fulfillment redirects */}
                                <Route path="/orders" element={<Navigate to="/orders-fulfillment?tab=overview" replace />} />
                                <Route path="/admin/forecast/submitted-orders" element={<Navigate to="/orders-fulfillment?tab=submitted" replace />} />
                                <Route path="/admin/dispatch/confirmations" element={<Navigate to="/orders-fulfillment?tab=dispatch" replace />} />
                                <Route path="/admin/dispatch/delivery" element={<Navigate to="/orders-fulfillment?tab=delivery" replace />} />
                                <Route path="/admin/dispatch/issues" element={<Navigate to="/orders-fulfillment?tab=issues" replace />} />

                                {/* Vendor redirects */}
                                <Route path="/vendors/add" element={<Navigate to="/vendors?tab=onboarding" replace />} />
                                <Route path="/admin/vendor-competitiveness" element={<Navigate to="/vendors?tab=performance" replace />} />

                                {/* Catalog & Reviews redirects */}
                                <Route path="/admin/manage-catalog" element={<Navigate to="/catalog-reviews?tab=catalog" replace />} />
                                <Route path="/admin/mapping-review" element={<Navigate to="/catalog-reviews?tab=review-queue" replace />} />
                                <Route path="/admin/catalog-review" element={<Navigate to="/catalog-reviews?tab=review-queue" replace />} />
                                <Route path="/admin/unmapped-items" element={<Navigate to="/catalog-reviews?tab=unmapped" replace />} />
                                <Route path="/admin/pending-reviews" element={<Navigate to="/catalog-reviews?tab=change-requests" replace />} />

                                {/* Intelligence redirects */}
                                <Route path="/admin/ai-intelligence" element={<Navigate to="/intelligence?tab=ai-summary" replace />} />
                                <Route path="/admin/marketplace-intelligence" element={<Navigate to="/intelligence?tab=price-intelligence" replace />} />
                                <Route path="/admin/vendor-allocation" element={<Navigate to="/intelligence?tab=allocation" replace />} />
                                <Route path="/admin/supply-capacity" element={<Navigate to="/intelligence?tab=capacity" replace />} />
                                <Route path="/admin/forecast/festivals" element={<Navigate to="/intelligence?tab=seasonality" replace />} />

                                {/* Finance redirects */}
                                <Route path="/admin/restaurant-invoices" element={<Navigate to="/finance?tab=restaurant-invoices" replace />} />
                                <Route path="/admin/invoices" element={<Navigate to="/finance?tab=vendor-invoices" replace />} />

                                {/* Platform Admin redirects */}
                                <Route path="/admin/restaurants" element={<Navigate to="/platform-admin?tab=restaurants" replace />} />
                                <Route path="/admin/manage-restaurants" element={<Navigate to="/platform-admin?tab=restaurants" replace />} />
                                <Route path="/users" element={<Navigate to="/platform-admin?tab=users" replace />} />
                                <Route path="/settings/permissions" element={<Navigate to="/platform-admin?tab=permissions" replace />} />
                                <Route path="/admin/migration" element={<Navigate to="/platform-admin?tab=migration" replace />} />
                            </>
                        )}

                        {/* ══════════════════════════════════════════════════════════
                            VENDOR / USER ROUTES — guarded by PrivateRoute
                           ══════════════════════════════════════════════════════════ */}
                        {!isSuperAdmin && (
                            <>
                                <Route path="/" element={<PrivateRoute requiredRole="vendor"><Dashboard /></PrivateRoute>} />
                                <Route path="/items" element={<PrivateRoute requiredRole="vendor"><ItemCatalogPage /></PrivateRoute>} />
                                <Route path="/vendors/:vendorId/items/:itemId" element={<PrivateRoute requiredRole="vendor"><ItemDetailPage /></PrivateRoute>} />
                                <Route path="/profile" element={<PrivateRoute requiredRole="vendor"><VendorDetailPage /></PrivateRoute>} />
                                <Route path="/dispatch-requests" element={<PrivateRoute requiredRole="vendor"><DispatchRequestsPage /></PrivateRoute>} />
                                <Route path="/dispatch-requests/:dispatchId" element={<PrivateRoute requiredRole="vendor"><DispatchDetailPage /></PrivateRoute>} />
                                <Route path="/vendor/invoices" element={<PrivateRoute requiredRole="vendor"><VendorInvoicesPage /></PrivateRoute>} />
                                <Route path="/vendor/invoices/:invoiceId" element={<PrivateRoute requiredRole="vendor"><InvoiceDetailPage /></PrivateRoute>} />
                                <Route path="/vendor/competitiveness" element={<PrivateRoute requiredRole="vendor"><VendorScoreDashboard /></PrivateRoute>} />
                                <Route path="/vendor/allocation" element={<PrivateRoute requiredRole="vendor"><VendorExpectedAllocation /></PrivateRoute>} />
                                <Route path="/vendor/capacity" element={<PrivateRoute requiredRole="vendor"><VendorCapacityPlanning /></PrivateRoute>} />
                                <Route path="/vendor/issues" element={<PrivateRoute requiredRole="vendor"><VendorIssuesSection /></PrivateRoute>} />
                                <Route path="/vendor/notifications" element={<PrivateRoute requiredRole="vendor"><VendorNotificationCenter /></PrivateRoute>} />
                                <Route path="/vendor/analytics" element={<PrivateRoute requiredRole="vendor"><VendorAnalytics /></PrivateRoute>} />
                                <Route path="/vendor/availability" element={<PrivateRoute requiredRole="vendor"><VendorAvailabilityCalendar /></PrivateRoute>} />
                                <Route path="/vendor/import" element={<PrivateRoute requiredRole="vendor"><VendorImportPage /></PrivateRoute>} />
                                <Route path="/vendor/import/preview" element={<PrivateRoute requiredRole="vendor"><VendorImportPreviewPage /></PrivateRoute>} />
                                <Route path="/vendor/import/history" element={<PrivateRoute requiredRole="vendor"><VendorImportHistoryPage /></PrivateRoute>} />
                                {isAdmin && (
                                    <>
                                        <Route path="/users" element={<PrivateRoute requiredRole="admin"><UserManagementPage /></PrivateRoute>} />
                                        <Route path="/settings/permissions" element={<PrivateRoute requiredRole="admin"><RolePermissionsPage /></PrivateRoute>} />
                                    </>
                                )}
                            </>
                        )}

                        {/* 404 */}
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                </div>
            </div>

            <ToastContainer
                position="top-right"
                autoClose={3000}
                hideProgressBar={false}
                theme="dark"
            />
        </div>
        </ErrorBoundary>
    );
}

export default App;
