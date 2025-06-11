// server.js atau di file inisialisasi Firebase Anda
const firebaseAdmin = require("firebase-admin");

// Cara 1: Menggunakan file service account (disarankan untuk produksi)
const serviceAccount = require("../../../firebase-credential.json");

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  storageBucket: "e-learning-rp.appspot.com", // Opsional, hanya jika menggunakan Cloud Storage
});

// Cara 2: Menggunakan environment variable (lebih aman untuk beberapa deployment)
// const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY); // Pastikan ini adalah string JSON
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

console.log("Firebase Admin SDK initialized!");

// Anda bisa mengekspor `admin` jika Anda membutuhkannya di modul lain
module.exports = firebaseAdmin;
