// src/App.js
import React, { useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UserContext } from './contexts/UserContext';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';

// Pages
import Dashboard from './components/Dashboard';
import VendorListPage from './components/Vendors/VendorListPage';
import VendorDetailPage from './components/Vendors/VendorDetailPage';
import ItemDetailPage from './components/Vendors/ItemDetailPage';
import AddVendorPage from './components/Vendors/AddVendorPage';
import ItemCatalogPage from './components/Vendors/ItemCatalogPage';
import UserManagementPage from './components/Users/UserManagementPage';
import OrdersPage from './components/Orders/OrdersPage';
import RolePermissionsPage from './components/Settings/RolePermissionsPage';

// Toasts
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function App() {
    const { role, isSuperAdmin } = useContext(UserContext);
    const navigate = useNavigate();
    const location = useLocation();

    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';

    // Mobile sidebar
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

    // Not logged in → show login
    if (!normalizedRole) {
        return <Login />;
    }

    return (
        <div className="app-container theme-neon">
            <Sidebar isOpen={showSidebar} onClose={() => setShowSidebar(false)} />

            <div className="main-content">
                <TopBar onMenuClick={() => setShowSidebar(true)} />

                <div className="page-content">
                    <Routes>
                        <Route path="/login" element={<Navigate to={isSuperAdmin ? "/vendors" : "/"} />} />

                        {/* ── Super Admin Routes ── */}
                        {isSuperAdmin && (
                            <>
                                <Route path="/vendors" element={<VendorListPage />} />
                                <Route path="/vendors/add" element={<AddVendorPage />} />
                                <Route path="/vendors/:vendorId" element={<VendorDetailPage />} />
                                <Route path="/vendors/:vendorId/items/:itemId" element={<ItemDetailPage />} />
                                <Route path="/users" element={<UserManagementPage />} />
                                <Route path="/orders" element={<OrdersPage />} />
                                <Route path="/settings/permissions" element={<RolePermissionsPage />} />
                                <Route path="/" element={<Navigate to="/vendors" />} />
                            </>
                        )}

                        {/* ── Vendor Admin / User Routes ── */}
                        {!isSuperAdmin && (
                            <>
                                <Route path="/" element={<Dashboard />} />
                                <Route path="/items" element={<ItemCatalogPage />} />
                                <Route path="/vendors/:vendorId/items/:itemId" element={<ItemDetailPage />} />
                                <Route path="/profile" element={<VendorDetailPage />} />
                                <Route path="/orders" element={<OrdersPage />} />
                                {normalizedRole === 'admin' && (
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
    );
}

export default App;
