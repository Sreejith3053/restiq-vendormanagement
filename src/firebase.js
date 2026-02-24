// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// 🔁 Define both configs — REPLACE with your actual Firebase project credentials
const devConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced",
    measurementId: "G-MMSWW29CM3"
};

const prodConfig = {
    apiKey: "AIzaSyBPycf54qDl8RjNWSfXuYDouXPkTxuE4Jg",
    authDomain: "restiq-vendormanagement.firebaseapp.com",
    projectId: "restiq-vendormanagement",
    storageBucket: "restiq-vendormanagement.firebasestorage.app",
    messagingSenderId: "110986028184",
    appId: "1:110986028184:web:d3f26dd97a2e0a3b851ced",
};

// 🌍 Choose config based on environment
const firebaseConfig =
    process.env.REACT_APP_ENV === "production" ? prodConfig : devConfig;

console.log("Using Firebase config for:", process.env.REACT_APP_ENV || "development");

// 🔥 Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "restiq-vendormanagement");
const storage = getStorage(app);

export { app, auth, db, storage };
