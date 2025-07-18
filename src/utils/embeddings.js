// utils/embeddingService.js
const { pipeline } = require("@huggingface/transformers");

let extractor = null; // Variabel global untuk instance extractor

/**
 * Menginisialisasi pipeline embedding.
 * Fungsi ini harus dipanggil sekali saat aplikasi dimulai.
 */
async function initializeEmbeddingPipeline() {
  if (!extractor) {
    // Pastikan hanya diinisialisasi sekali
    console.log(
      "Menginisialisasi pipeline embedding dengan @huggingface/transformers..."
    );
    try {
      // Pilih model yang cocok untuk text embedding.
      // 'mixedbread-ai/mxbai-embed-large-v1' adalah pilihan yang bagus.
      extractor = await pipeline(
        "feature-extraction",
        "mixedbread-ai/mxbai-embed-large-v1"
      );
      console.log("Pipeline embedding siap digunakan.");
    } catch (error) {
      console.error("Gagal menginisialisasi pipeline embedding:", error);
      // Anda mungkin ingin menangani error ini lebih lanjut,
      // seperti keluar dari aplikasi atau mencoba lagi.
      process.exit(1); // Contoh: Keluar dari proses jika inisialisasi gagal
    }
  }
}

/**
 * Mengembalikan instance extractor.
 * Pastikan initializeEmbeddingPipeline() sudah dipanggil sebelumnya.
 * @returns {object} Instance extractor pipeline.
 * @throws {Error} Jika extractor belum diinisialisasi.
 */
function getExtractor() {
  if (!extractor) {
    throw new Error(
      "Extractor belum diinisialisasi. Panggil initializeEmbeddingPipeline() terlebih dahulu."
    );
  }
  return extractor;
}

async function getEmbedding(text) {
  try {
    // Pastikan pipeline sudah diinisialisasi
    if (!extractor) {
      await initializeEmbeddingPipeline();
    }

    // Jalankan inferensi untuk mendapatkan embedding
    // 'pooling: mean' umumnya digunakan untuk mendapatkan embedding kalimat/dokumen
    // 'normalize: true' disarankan untuk perbandingan kemiripan menggunakan cosine similarity
    const output = await extractor(text, { pooling: "mean", normalize: true });

    // Output dari pipeline adalah objek dengan properti 'data' yang berisi Float32Array.
    // Ubah ke array JavaScript biasa agar lebih mudah diolah jika diperlukan.
    return Array.from(output.data);
  } catch (error) {
    console.error(
      "Error generating embedding with @huggingface/transformers:",
      error
    );
    return null;
  }
}

module.exports = {
  initializeEmbeddingPipeline,
  getExtractor,
  getEmbedding,
};
