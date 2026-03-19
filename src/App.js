// src/App.js
import React, { useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UserContext } from './contexts/UserContext';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';

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

// ── Toasts ──────────────────────────────────────────────────────────
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
    const { role, isSuperAdmin } = useContext(UserContext);
    const navigate = useNavigate();
    const location = useLocation();

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    const isAdmin = normalizedRole === 'admin';

    useAdminNotificationSync();

    const [showSidebar, setShowSidebar] = useState(false);

    // Persist last path
    useEffect(() => {
        if (normalizedRole) localStorage.setItem('vm_lastPath', location.pathname);
    }, [location.pathname, normalizedRole]);

    // Restore last path on refresh
    useEffect(() => {
        const savedRole = localStorage.getItem('vm_role');
        const savedPath = localStorage.getItem('vm_lastPath');
        if (savedRole && !normalizedRole) navigate(savedPath || '/');
    }, [normalizedRole, navigate]);

    // Close sidebar on route change (mobile)
    useEffect(() => {
        if (window.innerWidth < 1024) setShowSidebar(false);
    }, [location.pathname]);

    if (!normalizedRole) {
        return <Login />;
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

                        {/* ══════════════════════════════════════════════════════════
                            SUPER ADMIN ROUTES
                           ══════════════════════════════════════════════════════════ */}
                        {isSuperAdmin && (
                            <>
                                {/* ── 1. Control Tower (unchanged) ── */}
                                <Route path="/admin/forecast/control-tower" element={<GlobalSupplyControlTower />} />
                                <Route path="/admin/dashboard" element={<SuperAdminDashboard />} />
                                <Route path="/" element={<Navigate to="/admin/forecast/control-tower" />} />

                                {/* ── 2. Orders & Fulfillment (consolidated) ── */}
                                <Route path="/orders-fulfillment" element={<OrdersFulfillmentPage />} />

                                {/* ── 3. Vendors (consolidated) ── */}
                                <Route path="/vendors" element={<VendorsPage />} />
                                <Route path="/vendors/:vendorId" element={<VendorDetailPage />} />
                                <Route path="/vendors/:vendorId/items/:itemId" element={<ItemDetailPage />} />

                                {/* ── 4. Catalog & Reviews (consolidated) ── */}
                                <Route path="/catalog-reviews" element={<CatalogReviewsPage />} />

                                {/* ── 5. Intelligence (consolidated) ── */}
                                <Route path="/intelligence" element={<IntelligencePage />} />

                                {/* ── 6. Finance (consolidated) ── */}
                                <Route path="/finance" element={<FinancePage />} />
                                <Route path="/admin/restaurant-invoices/:invoiceId" element={<RestaurantInvoiceDetailPage />} />
                                <Route path="/admin/invoices/:invoiceId" element={<InvoiceDetailPage />} />

                                {/* ── 7. Platform Admin (consolidated) ── */}
                                <Route path="/platform-admin" element={<PlatformAdminPage />} />
                                <Route path="/admin/restaurants/:restaurantId" element={<AdminRestaurantDetailPage />} />

                                {/* ── Forecast internal routes (used by CT tabs) ── */}
                                <Route path="/admin/forecast/demand" element={<DemandForecastPage />} />
                                <Route path="/admin/forecast/intelligence" element={<ForecastIntelligencePage />} />
                                <Route path="/admin/forecast/restaurants" element={<RestaurantForecastPage />} />
                                <Route path="/admin/forecast/combined" element={<CombinedDemandPage />} />
                                <Route path="/admin/forecast/vendors" element={<VendorPlanningPage />} />
                                <Route path="/admin/forecast/accuracy" element={<ForecastAccuracyPage />} />
                                <Route path="/admin/forecast/alerts" element={<ForecastAlertsPage />} />
                                <Route path="/admin/forecast/settings" element={<ForecastSettingsPage />} />
                                <Route path="/admin/dispatch/warehouse" element={<WarehousePickListPage />} />
                                <Route path="/admin/forecast/suggested-order-review" element={<SuggestedOrderReview />} />

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
                            VENDOR ADMIN / USER ROUTES (unchanged)
                           ══════════════════════════════════════════════════════════ */}
                        {!isSuperAdmin && (
                            <>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/items" element={<ItemCatalogPage />} />
                                <Route path="/vendors/:vendorId/items/:itemId" element={<ItemDetailPage />} />
                                <Route path="/profile" element={<VendorDetailPage />} />
                                <Route path="/dispatch-requests" element={<DispatchRequestsPage />} />
                                <Route path="/dispatch-requests/:dispatchId" element={<DispatchDetailPage />} />
                                <Route path="/vendor/invoices" element={<VendorInvoicesPage />} />
                                <Route path="/vendor/invoices/:invoiceId" element={<InvoiceDetailPage />} />
                                <Route path="/vendor/competitiveness" element={<VendorScoreDashboard />} />
                                <Route path="/vendor/allocation" element={<VendorExpectedAllocation />} />
                                <Route path="/vendor/capacity" element={<VendorCapacityPlanning />} />
                                <Route path="/vendor/issues" element={<VendorIssuesSection />} />
                                <Route path="/vendor/notifications" element={<VendorNotificationCenter />} />
                                <Route path="/vendor/analytics" element={<VendorAnalytics />} />
                                <Route path="/vendor/availability" element={<VendorAvailabilityCalendar />} />
                                <Route path="/vendor/import" element={<VendorImportPage />} />
                                <Route path="/vendor/import/preview" element={<VendorImportPreviewPage />} />
                                <Route path="/vendor/import/history" element={<VendorImportHistoryPage />} />
                                {isAdmin && (
                                    <>
                                        <Route path="/users" element={<UserManagementPage />} />
                                        <Route path="/settings/permissions" element={<RolePermissionsPage />} />
                                    </>
                                )}
                            </>
                        )}

                        {/* 404 */}
                        <Route path="*" element={<h2 style={{ padding: 16, color: '#9db2ce' }}>404 - Page not found</h2>} />
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
