import { initializeApp } from "firebase/app";
import { getFirestore, collectionGroup, getDocs } from "firebase/firestore";
import fs from 'fs';

const devConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced"
};

const app = initializeApp(devConfig);
const db = getFirestore(app, "restiq-vendormanagement");

async function run() {
    let out = [];
    try {
        const itemSnaps = await getDocs(collectionGroup(db, 'items'));
        let logsFetched = 0;

        for (const logDoc of (await getDocs(collectionGroup(db, 'auditLog'))).docs) {
            out.push({ path: logDoc.ref.path, data: logDoc.data() });
            logsFetched++;
            if (logsFetched > 20) break;
        }

        fs.writeFileSync('logs_dump.json', JSON.stringify(out, null, 2));
        process.exit(0);
    } catch (e) {
        fs.writeFileSync('logs_error.txt', e.toString());
        process.exit(1);
    }
}
run();
