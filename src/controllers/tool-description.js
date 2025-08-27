const ToolDescription = require("../models/tool-description");
const { getQueryVector } = require("../services/embeddings/jina.service");

exports.addOrUpdateTool = async (req, res) => {
  const { name, description } = req.body;

  if (!name || !description) {
    return res
      .status(400)
      .json({ message: "Nama dan deskripsi tool harus diisi." });
  }

  try {
    // Cari tool yang sudah ada berdasarkan nama
    let toolDoc = await ToolDescription.findOne({ name });

    // Jika tidak ada, buat dokumen baru
    if (!toolDoc) {
      toolDoc = new ToolDescription({ name, description });
    } else {
      // Jika ada, perbarui deskripsi
      toolDoc.description = description;
    }

    const query = `Name: ${name}, Description: ${description}`;

    // Buat vektor embedding dari deskripsi baru
    const embeddingVector = await getQueryVector(query, "tool-description");
    if (!embeddingVector) {
      return res
        .status(500)
        .json({ message: "Gagal membuat embedding untuk deskripsi." });
    }
    toolDoc.embedding = embeddingVector;

    await toolDoc.save();

    res.status(200).json({
      message: "Tool berhasil ditambahkan/diperbarui.",
      tool: toolDoc,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Nama tool sudah ada." });
    }
    console.error(error);
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
};

exports.getBestMatchingTool = async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.status(400).json({ message: "Input query tidak boleh kosong." });
  }

  // Langkah 1: Ubah query pengguna menjadi vektor embedding
  const userQueryVector = await getQueryVector(query, "tool-description");
  if (!userQueryVector) {
    return res
      .status(500)
      .json({ message: "Gagal membuat embedding untuk query." });
  }

  try {
    // Langkah 2: Jalankan pipeline aggregate untuk pencarian vektor
    const results = await ToolDescription.aggregate([
      {
        $vectorSearch: {
          index: "default", // Nama indeks yang Anda berikan
          path: "embedding",
          queryVector: userQueryVector,
          numCandidates: 10, // Tetap gunakan numCandidates untuk akurasi
          limit: 10,
          // Tidak ada limit di sini, jadi akan mengembalikan semua hasil
        },
      },
      // Langkah 3: Proyeksi untuk memformat output
      {
        $project: {
          _id: 0, // Jangan tampilkan _id
          name: 1, // Tampilkan nama tool
          description: 1, // Tampilkan deskripsi tool
          score: { $meta: "vectorSearchScore" }, // Tampilkan skor cosine similarity
        },
      },
    ]);

    // Langkah 4: Tentukan ambang batas (threshold) kecocokan
    const similarityThreshold = 0.6; // Sesuaikan ambang batas ini sesuai kebutuhan

    // Filter hasil yang skornya di atas ambang batas
    const relevantTools = results.filter(
      (tool) => tool.score >= similarityThreshold
    );

    // Kirim respons
    if (relevantTools.length > 0) {
      res.status(200).json(relevantTools);
    } else {
      res.status(404).json({
        message: "Tidak ada tool yang cocok ditemukan.",
        bestMatch: results.length > 0 ? results[0] : null,
      });
    }
  } catch (error) {
    console.error("Error during vector search:", error);
    res
      .status(500)
      .json({ message: "Terjadi kesalahan saat melakukan pencarian vektor." });
  }
};
