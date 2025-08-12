// utils/embeddingService.js
const {
  pipeline,
  cos_sim: cosineSimilarity,
  AutoModel,
  AutoProcessor,
  matmul,
} = require("@huggingface/transformers");

let extractor = null;
const model_id = "jinaai/jina-clip-v2";
let processor = null;
let model = null;
/**
 * Menginisialisasi pipeline embedding.
 * Fungsi ini harus dipanggil sekali saat aplikasi dimulai.
 */
async function initializeEmbeddingPipeline() {
  if (!model) {
    // Pastikan hanya diinisialisasi sekali
    console.log(
      "Menginisialisasi pipeline embedding dengan @huggingface/transformers..."
    );
    try {
      // Pilih model yang cocok untuk text embedding.
      // 'mixedbread-ai/mxbai-embed-large-v1' adalah pilihan yang bagus.
      // extractor = await pipeline(
      //   "feature-extraction",
      //   // "mixedbread-ai/mxbai-embed-large-v1"
      //   // "Xenova/all-MiniLM-L6-v2"
      //   // "sentence-transformers/all-MiniLM-L6-v2"
      //   // "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
      //   "jinaai/jina-clip-v2"
      // );
      processor = await AutoProcessor.from_pretrained(model_id);
      model = await AutoModel.from_pretrained(model_id, {
        dtype: "q4" /* e.g., "fp16", "q8", or "q4" */,
      });
      console.log("Pipeline embedding siap digunakan.");
    } catch (error) {
      console.error("Gagal menginisialisasi pipeline embedding:", error);
      // Anda mungkin ingin menangani error ini lebih lanjut,
      // seperti keluar dari aplikasi atau mencoba lagi.
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
    if (!model) {
      await initializeEmbeddingPipeline();
    }

    // Jalankan inferensi untuk mendapatkan embedding
    // 'pooling: mean' umumnya digunakan untuk mendapatkan embedding kalimat/dokumen
    // 'normalize: true' disarankan untuk perbandingan kemiripan menggunakan cosine similarity
    // const output = await extractor(text, { pooling: "mean", normalize: true });

    // Output dari pipeline adalah objek dengan properti 'data' yang berisi Float32Array.
    // Ubah ke array JavaScript biasa agar lebih mudah diolah jika diperlukan.
    // return Array.from(output.data);

    const query_inputs = await processor(text);
    const { l2norm_text_embeddings: query_embeddings } = await model(
      query_inputs
    );
    const embeddingTensor = query_embeddings[0];
    const embeddingData = embeddingTensor.ort_tensor.cpuData;
    return Array.from(embeddingData);
  } catch (error) {
    console.error(
      "Error generating embedding with @huggingface/transformers:",
      error
    );
    return null;
  }
}

async function checkSemanticMatch(
  textOrEmbedding1,
  textOrEmbedding2,
  threshold = 0.6
) {
  let embedding1;
  let embedding2;

  // Determine if input is text or embedding
  if (Array.isArray(textOrEmbedding1)) {
    embedding1 = textOrEmbedding1;
  } else {
    embedding1 = await getEmbedding(textOrEmbedding1);
  }

  if (Array.isArray(textOrEmbedding2)) {
    embedding2 = textOrEmbedding2;
  } else {
    embedding2 = await getEmbedding(textOrEmbedding2);
  }

  if (!embedding1 || !embedding2) {
    // console.warn("WARNING: Could not generate embeddings for semantic match check.");
    return false; // Cannot perform semantic match without embeddings
  }

  const similarity = cosineSimilarity(embedding1, embedding2);
  // console.log(`  Semantic Match Check: "${textOrEmbedding1}" vs "${textOrEmbedding2}" -> Similarity: ${similarity.toFixed(4)} (Threshold: ${threshold})`);
  return similarity >= threshold;
}

function normalizeTextForSearch(text) {
  if (text === null || text === undefined) return ""; // Handle null/undefined input
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, " ") // Ganti multiple spaces dengan single space
    .trim(); // Hapus spasi di awal/akhir
}

module.exports = {
  initializeEmbeddingPipeline,
  getExtractor,
  getEmbedding,
  normalizeTextForSearch,
  checkSemanticMatch,
};
