const { GoogleGenAI } = require("@google/genai");
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error(
    "GEMINI_API_KEY tidak ditemukan di environment variables. Pastikan sudah diatur."
  );
  // Dalam production, Anda mungkin ingin melempar error atau menangani dengan cara lain
  // Untuk pengembangan, kita bisa keluar dari proses
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: API_KEY });

module.exports = genAI;
