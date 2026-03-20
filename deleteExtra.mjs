import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, query, limit } from 'firebase/firestore';

const app = initializeApp({
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced",
});
const db = getFirestore(app, "restiq-vendormanagement");

async function deleteColl(name) {
    let deleted = 0;
    while (true) {
        const snap = await getDocs(query(collection(db, name), limit(400)));
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 400) break;
    }
    return deleted;
}

async function main() {
    console.log('Deleting containerPredictionHistory...');
    const n = await deleteColl('containerPredictionHistory');
    console.log(`✅ Deleted ${n} docs from containerPredictionHistory`);
    process.exit(0);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
