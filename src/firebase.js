// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, browserSessionPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced",
    measurementId: "G-MMSWW29CM3",
};

// 🔥 Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "restiq-vendormanagement");
const storage = getStorage(app);

// 🔐 Use session persistence — auth state dies when the tab closes.
// The Firebase SDK manages its own secure token; we do NOT put user objects in localStorage.
setPersistence(auth, browserSessionPersistence).catch((err) => {
    console.warn("[Firebase] Could not set session persistence:", err.message);
});

export { app, auth, db, storage };

