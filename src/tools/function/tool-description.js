const axios = require("axios"); // Pastikan Anda sudah menginstal axios: npm install axios

// Fungsi untuk mengambil tool description yang cocok dari database
const findRelevantTools = async (userQuery) => {
  try {
    const response = await axios.post(
      "http://localhost:4001/tool-description/best-matching-tool",
      {
        query: userQuery,
      }
    );

    // Asumsikan endpoint mengembalikan array
    const relevantTools = response.data;

    // Format ulang data agar lebih mudah dibaca oleh LLM
    const formattedTools = relevantTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      score: tool.score,
    }));

    return formattedTools;
  } catch (error) {
    console.error(
      "Error finding relevant tools:",
      error.response?.data || error.message
    );
    return []; // Kembalikan array kosong jika terjadi kesalahan
  }
};

module.exports = { findRelevantTools };
