// Firebase web config. These values are NOT secret — they identify your
// Firebase project to the browser. Access is protected by firestore.rules.
//
// Get them from: Firebase console → Project settings → General →
// "Your apps" → Web app → SDK setup and configuration → Config.
// Get the VAPID key from: Project settings → Cloud Messaging →
// Web configuration → Web Push certificates → Key pair.
//
// Loaded as a classic script by both the page and the service worker.
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBKyTCQRpLhD-TzRtIhtXhLL94t9WuJvSk",
  authDomain: "task-reminder-f7a06.firebaseapp.com",
  projectId: "task-reminder-f7a06",
  storageBucket: "task-reminder-f7a06.firebasestorage.app",
  messagingSenderId: "528536453742",
  appId: "1:528536453742:web:7f8d45c587d1f17da61c7f",
};
self.FIREBASE_VAPID_KEY = "BDCClXQsv_59r9LBi3rz6tPZKw1nopDI9M3Se-v0OsjOixLqPm_VX5nDQTYQuzQKJLiV0RexWqKnmAlK18ZU69M";
