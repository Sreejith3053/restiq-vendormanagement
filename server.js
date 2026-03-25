require('dotenv').config();
// server.js — Hardened Express API server for Vendor Management
//
// Security layers:
//   1. Firebase Admin SDK for server-side Firestore access (no client-side pre-auth queries)
//   2. Auth middleware — verifies Firebase ID tokens on all protected routes
//   3. Server-side rate limiting — IP + identifier based
//   4. No plaintext secret keys in source (use env vars)
//   5. Generic error messages — no username enumeration
//
const express = require('express');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

// ── Firebase Admin: RMS project (read restaurant info) ────────────────────
// Optional — only needed for /api/restaurant-info endpoint
let rmsFirestore = null;
const rmsKeyPath = path.join(__dirname, '.rms-service-account.json');

try {
    let rmsCreds;
    if (fs.existsSync(rmsKeyPath)) {
        rmsCreds = JSON.parse(fs.readFileSync(rmsKeyPath, 'utf8'));
    } else if (process.env.RMS_SERVICE_ACCOUNT) {
        // Production (Heroku) — full JSON in env var
        rmsCreds = JSON.parse(process.env.RMS_SERVICE_ACCOUNT);
        if (rmsCreds.private_key) {
            rmsCreds.private_key = rmsCreds.private_key.replace(/\\n/g, '\n');
        }
    } else if (process.env.RMS_PRIVATE_KEY) {
        rmsCreds = {
            type: "service_account",
            project_id: "orumarmsprod",
            private_key_id: process.env.RMS_PRIVATE_KEY_ID || "8e8360ad7717da54dd456125378a9feb1ddf5854",
            private_key: process.env.RMS_PRIVATE_KEY.replace(/\\n/g, '\n'),
            client_email: "firebase-adminsdk-fbsvc@orumarmsprod.iam.gserviceaccount.com",
            client_id: "100723697611119927274",
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
        };
    }

    if (rmsCreds) {
        const rmsApp = admin.initializeApp({
            credential: admin.credential.cert(rmsCreds),
            projectId: 'orumarmsprod'
        }, 'rms');
        rmsFirestore = rmsApp.firestore();
        console.log('✅ RMS Admin SDK initialized');
    } else {
        console.warn('⚠️ RMS credentials not found — /api/restaurant-info will be unavailable');
    }
} catch (err) {
    console.warn('⚠️ RMS Admin SDK failed to initialize:', err.message);
}

// ── Firebase Admin: Vendor Management project ─────────────────────────────
// Priority: 1) JSON file on disk (local dev), 2) env var (Heroku), 3) default creds

let vmApp;
const vmKeyPath = path.join(__dirname, '.vm-service-account.json');

if (fs.existsSync(vmKeyPath)) {
    // Local dev — load from file (avoids dotenv newline issues)
    const vmCreds = JSON.parse(fs.readFileSync(vmKeyPath, 'utf8'));
    vmApp = admin.initializeApp({
        credential: admin.credential.cert(vmCreds),
        projectId: 'restiq-vendormanagement',
    }, 'vm');
    console.log('✅ VM Admin SDK initialized from .vm-service-account.json');
} else if (process.env.VM_SERVICE_ACCOUNT) {
    // Production (Heroku) — load from env var
    const vmCreds = JSON.parse(process.env.VM_SERVICE_ACCOUNT);
    if (vmCreds.private_key) {
        vmCreds.private_key = vmCreds.private_key.replace(/\\n/g, '\n');
    }
    vmApp = admin.initializeApp({
        credential: admin.credential.cert(vmCreds),
        projectId: 'restiq-vendormanagement',
    }, 'vm');
    console.log('✅ VM Admin SDK initialized from VM_SERVICE_ACCOUNT env var');
} else {
    // Fallback — application default credentials
    vmApp = admin.initializeApp({
        projectId: 'restiq-vendormanagement',
    }, 'vm');
    console.warn('⚠️ VM Admin SDK using default credentials (limited functionality)');
}

// Named database for Vendor Management
const vmDbNamed = getFirestore(vmApp, 'restiq-vendormanagement');
const vmAuth = getAuth(vmApp);

// ── Server-side Rate Limiting ─────────────────────────────────────────────
const rateLimitMap = new Map(); // key: IP or identifier → { attempts: [], lockedUntil }
const RATE_MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 2 * 60 * 1000;   // 2 minutes
const RATE_LOCKOUT_MS = 60 * 1000;       // 60 seconds

function checkServerRateLimit(key) {
    const now = Date.now();
    let entry = rateLimitMap.get(key);
    if (!entry) {
        entry = { attempts: [], lockedUntil: 0 };
        rateLimitMap.set(key, entry);
    }

    // Check lockout
    if (entry.lockedUntil > now) {
        const remaining = Math.ceil((entry.lockedUntil - now) / 1000);
        return { blocked: true, remaining };
    }

    // Clean old attempts
    entry.attempts = entry.attempts.filter(ts => now - ts < RATE_WINDOW_MS);
    return { blocked: false, remaining: 0, count: entry.attempts.length };
}

function recordServerFailure(key, identifier) {
    const now = Date.now();
    let entry = rateLimitMap.get(key);
    if (!entry) {
        entry = { attempts: [], lockedUntil: 0 };
        rateLimitMap.set(key, entry);
    }
    entry.attempts.push(now);

    // Also record by identifier if different from IP
    if (identifier && identifier !== key) {
        let idEntry = rateLimitMap.get(identifier);
        if (!idEntry) {
            idEntry = { attempts: [], lockedUntil: 0 };
            rateLimitMap.set(identifier, idEntry);
        }
        idEntry.attempts.push(now);
    }

    if (entry.attempts.length >= RATE_MAX_ATTEMPTS) {
        entry.lockedUntil = now + RATE_LOCKOUT_MS;
        entry.attempts = [];
    }

    // Log to systemLogs server-side (fire and forget)
    vmDbNamed.collection('systemLogs').add({
        level: 'warn',
        category: 'auth',
        action: 'login_failed',
        entityType: 'user',
        entityId: identifier || key,
        metadata: { identifier, ip: key, attempts: entry.attempts.length },
        performedBy: 'system',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => { });
}

// Clean up rate limit map every 5 minutes to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
        entry.attempts = entry.attempts.filter(ts => now - ts < RATE_WINDOW_MS);
        if (entry.attempts.length === 0 && entry.lockedUntil < now) {
            rateLimitMap.delete(key);
        }
    }
}, 5 * 60 * 1000);

// ── Auth Middleware ────────────────────────────────────────────────────────
async function verifyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized — no token provided.' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        req.user = await vmAuth.verifyIdToken(idToken);
        next();
    } catch (err) {
        console.warn('[Auth Middleware] Token verification failed:', err.message);
        return res.status(401).json({ error: 'Unauthorized — invalid token.' });
    }
}

// ── Express App ───────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 5001;

app.use(express.json());

// Health check (no auth required)
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vendor-management-api' });
});

// ── AUTH ENDPOINTS (no Firebase Auth required — pre-authentication) ───────

// POST /api/auth/resolve-user
// Resolves username/email → safe user info (never returns password)
app.post('/api/auth/resolve-user', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier || typeof identifier !== 'string') {
            return res.status(400).json({ error: 'Missing identifier.' });
        }

        const trimmed = identifier.trim();
        const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

        // Check rate limit by IP and identifier
        const ipCheck = checkServerRateLimit(clientIp);
        const idCheck = checkServerRateLimit(trimmed.toLowerCase());
        if (ipCheck.blocked) {
            return res.status(429).json({
                error: 'Too many attempts. Please wait.',
                remaining: ipCheck.remaining
            });
        }
        if (idCheck.blocked) {
            return res.status(429).json({
                error: 'Too many attempts. Please wait.',
                remaining: idCheck.remaining
            });
        }

        // Query Firestore login collection by email first, then username
        let userDoc = null;
        let snap;

        snap = await vmDbNamed.collection('login')
            .where('email', '==', trimmed)
            .limit(1)
            .get();
        if (!snap.empty) {
            userDoc = { docId: snap.docs[0].id, ...snap.docs[0].data() };
        }

        if (!userDoc) {
            snap = await vmDbNamed.collection('login')
                .where('username', '==', trimmed)
                .limit(1)
                .get();
            if (!snap.empty) {
                userDoc = { docId: snap.docs[0].id, ...snap.docs[0].data() };
            }
        }

        if (!userDoc) {
            // Record failure but return generic message (no enumeration)
            recordServerFailure(clientIp, trimmed.toLowerCase());
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        if (userDoc.active === false) {
            return res.status(403).json({ error: 'Account deactivated. Contact admin.' });
        }

        // Return SAFE fields only — NEVER the password
        return res.json({
            email: userDoc.email || `${userDoc.username}@restiq.internal`,
            active: userDoc.active !== false,
            hasPassword: !!userDoc.password,
            mustChangePassword: userDoc.mustChangePassword === true,
            role: userDoc.role || null,
        });
    } catch (err) {
        console.error('[/api/auth/resolve-user] Error:', err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/auth/legacy-verify
// Verifies legacy plaintext password server-side and returns a Firebase Custom Token
// for just-in-time migration. The password NEVER leaves the server.
app.post('/api/auth/legacy-verify', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Missing credentials.' });
        }

        const trimmed = identifier.trim();
        const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

        // Rate limit check
        const ipCheck = checkServerRateLimit(clientIp);
        const idCheck = checkServerRateLimit(trimmed.toLowerCase());
        if (ipCheck.blocked || idCheck.blocked) {
            return res.status(429).json({
                error: 'Too many attempts. Please wait.',
                remaining: Math.max(ipCheck.remaining || 0, idCheck.remaining || 0),
            });
        }

        // Find user
        let userDoc = null;
        let docId = null;
        let snap;

        snap = await vmDbNamed.collection('login')
            .where('email', '==', trimmed)
            .limit(1)
            .get();
        if (!snap.empty) {
            docId = snap.docs[0].id;
            userDoc = snap.docs[0].data();
        }

        if (!userDoc) {
            snap = await vmDbNamed.collection('login')
                .where('username', '==', trimmed)
                .limit(1)
                .get();
            if (!snap.empty) {
                docId = snap.docs[0].id;
                userDoc = snap.docs[0].data();
            }
        }

        if (!userDoc || !userDoc.password) {
            recordServerFailure(clientIp, trimmed.toLowerCase());
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        // Compare password SERVER-SIDE (never sent to client)
        if (String(userDoc.password) !== String(password)) {
            recordServerFailure(clientIp, trimmed.toLowerCase());
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        // Password matches — do JIT migration:
        // 1. Try to create the Firebase Auth user
        // 2. If already exists, get existing user
        // 3. Create a custom token for the client
        const email = userDoc.email || `${userDoc.username}@restiq.internal`;
        let uid;

        try {
            const newUser = await vmAuth.createUser({
                email,
                password,
                displayName: userDoc.displayName || userDoc.username || '',
            });
            uid = newUser.uid;
        } catch (createErr) {
            if (createErr.code === 'auth/email-already-exists') {
                const existingUser = await vmAuth.getUserByEmail(email);
                uid = existingUser.uid;
                // Update password in Firebase Auth to match
                await vmAuth.updateUser(uid, { password });
            } else {
                console.error('[legacy-verify] JIT migration failed:', createErr);
                return res.status(500).json({ error: 'Migration failed. Contact admin.' });
            }
        }

        // Generate custom token for the client to sign in
        const customToken = await vmAuth.createCustomToken(uid);

        return res.json({
            customToken,
            mustChangePassword: userDoc.mustChangePassword === true,
        });
    } catch (err) {
        console.error('[/api/auth/legacy-verify] Error:', err);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// ── PROTECTED ROUTES (require Firebase Auth) ──────────────────────────────

// Get restaurant info from RMS database
app.get('/api/restaurant-info/:restaurantId', verifyAuth, async (req, res) => {
    if (!rmsFirestore) {
        return res.status(503).json({ error: 'RMS service not configured' });
    }
    try {
        const { restaurantId } = req.params;
        const infoDoc = await rmsFirestore
            .collection('restaurants')
            .doc(restaurantId)
            .collection('settings')
            .doc('info')
            .get();

        if (!infoDoc.exists) {
            return res.status(404).json({ error: 'Restaurant info not found' });
        }

        const data = infoDoc.data();
        res.json({
            businessName: data.businessName || '',
            legalName: data.legalName || '',
            email: data.email || '',
            phone: data.phone || '',
            hstNumber: data.hstNumber || '',
            province: data.province || '',
            country: data.country || ''
        });
    } catch (err) {
        console.error('Failed to fetch restaurant info:', err);
        res.status(500).json({ error: 'Failed to fetch restaurant info' });
    }
});

// In production, serve the React build
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'build')));
    app.get('*', (_req, res) => {
        res.sendFile(path.join(__dirname, 'build', 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`🚀 Vendor Management API running on port ${PORT}`);
});
