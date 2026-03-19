#!/usr/bin/env node
/**
 * migrateUsersToFirebaseAuth.js
 *
 * One-time migration script: reads all users from the Firestore `login` collection
 * and creates corresponding Firebase Auth accounts, then removes the `password` field
 * from each Firestore document.
 *
 * PREREQUISITES:
 *   1. Install Firebase Admin SDK: npm install firebase-admin --save-dev
 *   2. Download a service account key from Firebase Console →
 *      Project Settings → Service Accounts → Generate new private key
 *      Save as: scripts/serviceAccountKey.json
 *
 * USAGE:
 *   # Dry run (no changes made — just shows what WOULD happen):
 *   node scripts/migrateUsersToFirebaseAuth.js --dry-run
 *
 *   # Live run (makes changes — take a Firestore backup first!):
 *   node scripts/migrateUsersToFirebaseAuth.js
 *
 * WHAT IT DOES:
 *   For each user in the `login` collection:
 *   1. Creates a Firebase Auth account with uid = <docId>, email = <data.email>
 *      Note: Firebase Auth requires an email. If the user only has a username,
 *      a synthetic email is generated: <username>@restiq.internal
 *   2. Removes the `password` field from Firestore (does NOT modify any other fields)
 *   3. Skips users who already have a Firebase Auth account (idempotent)
 *
 * Sreejith / Platform Team — March 2026
 */

const path = require('path');
const admin = require('firebase-admin');

// ── Config ──────────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const DATABASE_ID = 'restiq-vendormanagement';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Initialise ───────────────────────────────────────────────────────────────
let serviceAccount;
try {
    serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (err) {
    console.error('\n❌  Could not load service account key.');
    console.error('   Expected at:', SERVICE_ACCOUNT_PATH);
    console.error('   Download it from: Firebase Console → Project Settings → Service Accounts\n');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

// ── Migration ────────────────────────────────────────────────────────────────
async function run() {
    console.log('\n═══════════════════════════════════════════');
    console.log(' RestIQ — Firebase Auth Migration Script');
    console.log(DRY_RUN ? ' MODE: DRY RUN (no changes will be made)' : ' MODE: LIVE (changes WILL be written)');
    console.log('═══════════════════════════════════════════\n');

    const loginSnap = await db.collection('login').get();
    console.log(`📋 Found ${loginSnap.size} user(s) in the 'login' collection.\n`);

    const results = { created: 0, skipped: 0, failed: 0, passwordsRemoved: 0 };

    for (const docSnap of loginSnap.docs) {
        const uid = docSnap.id;
        const data = docSnap.data();

        // Determine email
        let email = data.email;
        if (!email && data.username) {
            email = `${data.username}@restiq.internal`;
            console.log(`  ⚠️  User ${uid} has no email — using synthetic: ${email}`);
        }
        if (!email) {
            console.warn(`  ⚠️  Skipping ${uid} — no email or username found.`);
            results.skipped++;
            continue;
        }

        // Check if Firebase Auth account already exists
        let existingUser = null;
        try {
            existingUser = await admin.auth().getUser(uid);
        } catch (e) {
            if (e.code !== 'auth/user-not-found') {
                console.error(`  ❌  Error checking auth for ${uid}:`, e.message);
                results.failed++;
                continue;
            }
        }

        if (existingUser) {
            console.log(`  ✅  SKIP  ${uid} (${email}) — already has Firebase Auth account`);
            results.skipped++;
        } else {
            const displayName = data.displayName || data.name || data.username || email;
            const plainPassword = data.password;

            if (!plainPassword) {
                console.warn(`  ⚠️  ${uid} (${email}) — no password field found. Creating account with random temp password.`);
            }

            if (!DRY_RUN) {
                try {
                    await admin.auth().createUser({
                        uid,
                        email,
                        displayName,
                        password: plainPassword || generateTempPassword(),
                        disabled: data.active === false,
                    });
                    console.log(`  🔐  CREATED  Firebase Auth for ${uid} (${email})`);
                    results.created++;
                } catch (createErr) {
                    console.error(`  ❌  FAILED to create auth for ${uid}:`, createErr.message);
                    results.failed++;
                    continue;
                }
            } else {
                console.log(`  [DRY-RUN]  Would create Firebase Auth for ${uid} (${email})`);
                results.created++;
            }
        }

        // Remove the plaintext password from Firestore
        if (data.password !== undefined) {
            if (!DRY_RUN) {
                try {
                    await db.doc(`login/${uid}`).update({
                        password: admin.firestore.FieldValue.delete(),
                        _passwordMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    console.log(`  🗑️   Removed 'password' field from login/${uid}`);
                    results.passwordsRemoved++;
                } catch (updateErr) {
                    console.error(`  ❌  Failed to remove password for ${uid}:`, updateErr.message);
                }
            } else {
                console.log(`  [DRY-RUN]  Would remove 'password' from login/${uid}`);
                results.passwordsRemoved++;
            }
        }
    }

    console.log('\n═══════════════════════════════════════════');
    console.log(' Migration Complete');
    console.log('═══════════════════════════════════════════');
    console.log(`  Auth accounts created : ${results.created}`);
    console.log(`  Skipped (existing)    : ${results.skipped}`);
    console.log(`  Failed                : ${results.failed}`);
    console.log(`  Passwords removed     : ${results.passwordsRemoved}`);
    if (DRY_RUN) {
        console.log('\n  ⚠️  This was a DRY RUN — run without --dry-run to apply.');
    }
    console.log('');
}

function generateTempPassword() {
    return `RestIQ_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

run().catch((err) => {
    console.error('\n❌  Unhandled migration error:', err);
    process.exit(1);
});
