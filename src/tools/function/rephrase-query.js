const rephraseQuery = async ({ originalQuery, reason, newQuerySuggestion }) => {
  console.log(
    `Rephrase query dipanggil. Query asli: "${originalQuery}", Alasan: "${reason}", Saran: "${
      newQuerySuggestion || "Tidak ada saran baru."
    }"`
  );

  if (newQuerySuggestion) {
    return {
      content: `Pencarian untuk "${originalQuery}" gagal karena "${reason}". Saran: Gunakan query yang disarankan: "${newQuerySuggestion}" untuk mencoba kembali.`,
    };
  } else {
    return {
      content: `Pencarian untuk "${originalQuery}" gagal karena "${reason}". Tidak ada saran query baru yang dapat diberikan. Berikan jawaban akhir yang sopan kepada pelanggan.`,
    };
  }
};

const rephraseQueryFunctionTools = {
  rephraseQuery,
};

module.exports = rephraseQueryFunctionTools;
