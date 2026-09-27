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
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
self.FIREBASE_VAPID_KEY = "REPLACE_ME";
