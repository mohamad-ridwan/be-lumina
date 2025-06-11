// server.js atau di file inisialisasi Firebase Anda
const firebaseAdmin = require("firebase-admin");

// Cara 1: Menggunakan file service account (disarankan untuk produksi)
// const serviceAccount = {
//   type: "service_account",
//   project_id: "e-learning-rp",
//   private_key_id: "670e8258e965b3f19fa80ebf4fc63c40838d2a92",
//   private_key:
//     "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCv7nCIxkVN8M1C\nevnjIcLmU6Byuc/Ht/ElOoQINzkaEsVF0XXwSF8wr0iXJx9fWO8q4SCQZptDIEIc\nkU9btpSvsI2D1h97+z6tSdtz9nZLgfdU4Li2W/QUHrUfxnmUvvaEDZXQd0AWLYlr\nGWSdAuRC2XZHzzMd8E2mhgg0tD0DVhBgFoh2lZ/H9i67qhDHCT5HMpXthfv2ks7T\nLzO+y2PkuNa645M0N4eFmwee9aWtHKtCt0rOkWulu0FEip9bov7eebFKWZjUYeE7\nxNcUdUfpg/0FFWFdvs0jGwRcecDlgz84yz7v0XR+4bbLPT3MinO2Zj8Qitqbkr9K\nRRdIUWh5AgMBAAECggEAUHd3YyeEVVS5HRoQJzGu6hf/v9l6znc0RXnRH8zaQjGp\npvhZwA/p8eOKCRBsyfhsU6lqcoFrrDUZ5+USbflBYmYXI+CQv+03Sp0IUa69hmWo\nUVsDQO0n4vf0kdb+jukU6WspRZL1be9f9etEWIgVDPpXnhqH376kVXDiWfDCIz67\nuyiOxqsAt2ufWwHH9L36ZBh4fbeHpOEQLAv/9iViYDv9JSfCuh6nbmSNrRdbO9yD\nKFiG/jzj5O042H0rNw1B5QkTwNfHtWZ6SYl6nB4UVCYH08/2Auo3QCj5F1XiCgZI\noTpxu+9DglenAXuA8uGiPZagTMXWUQaEbVE/FFfI7QKBgQDsH4sBYywiuRRgUzra\najyH4Rfgndg3jmzXeGmTQdvKzBE4FbzbNeJ7ciKVVqZFvYMd4zxRMXdCza0eM89s\nj+q47BtuVoH2uHKE+QY9NnKgYndRbq2DaGUo+LrjTHY4wuBdXRka5kSzoD0QifQs\nmUy59EyTDOT3HqA3D7TlNazLJwKBgQC+vcM80I8uyjJlWLOltVsss1Y4vRcefx23\nOTCAhRbPstunRz3DCY0VvCLPjBY4IrVB3jktMQPm6crxUdfwh06IzIRlfaNPSnQH\nyXjd9IRhSfcSWPngRh+xYggeHzusannMDv9qQx76rMHLhj7FswSzMn5mIgREtIey\nHv9azkTzXwKBgAtpDs+XWkenR/vLqdlqLtimIQBCwHMW192lvPxXv2ZSbDaYnlK9\njN9ISbGLyWcvXEmydHS7/jZlOAtwl4J4hfA/wKeZWJhym14fppSIsAteFsQBpDLo\ndZMASg+33zKpACyi1ha9r+46PRkygXEyS0nlK1oj0mC6wyVGBgjZiisbAoGAVZ3G\nCgEvk/gMgPM8yA/Mmhbxh8xQmU7Dnt+bxsR2hcop0D8pGOernWryUSj3PEFQDP3b\nuk47CyY8AvAStpN1i/AJKakoacnopSopB6/ez/CsZ17q4mF3jl6LeEHavjyY6SB+\nQ0tXl3t+DYX3nTQK0wjCNcPlGJXUJv7E7hSSXI8CgYEAyAdcbiun7Um2sxmzVIrU\nnt7JctmbrXfvaUgefBHqsMqOeEBDIey7s4VLOXeBkneI36oev5SEWRH30806W9d/\ngyUdN98PiEFcHsz+8YXMOVY8P4gzi30r+i8Sifn1NAx42YJKUUOQYpyEgY6e2jHf\nace7leynlGYyep5WxBeJ/qc=\n-----END PRIVATE KEY-----\n",
//   client_email: "firebase-adminsdk-6vzfx@e-learning-rp.iam.gserviceaccount.com",
//   client_id: "116060432843880874298",
//   auth_uri: "https://accounts.google.com/o/oauth2/auth",
//   token_uri: "https://oauth2.googleapis.com/token",
//   auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
//   client_x509_cert_url:
//     "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-6vzfx%40e-learning-rp.iam.gserviceaccount.com",
//   universe_domain: "googleapis.com",
// };

firebaseAdmin.initializeApp({
  // credential: firebaseAdmin.credential.cert(serviceAccount),
  storageBucket: "e-learning-rp.appspot.com", // Opsional, hanya jika menggunakan Cloud Storage
});

// Cara 2: Menggunkan environment variable (lebih aman untuk beberapa deployment)
// const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY); // Pastikan ini adalah string JSON
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

console.log("Firebase Admin SDK initialized!");

// Anda bisa mengekspor `admin` jika Anda membutuhkannya di modul lain
module.exports = firebaseAdmin;
