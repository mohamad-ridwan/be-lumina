const rephraseQuery = async ({ failedQuery, reason, newQuerySuggestion }) => {
  // Fungsi ini tidak melakukan aksi, hanya mengembalikan sinyal untuk LLM.
  console.log(
    `Rephrase query dipanggil. Query gagal: "${failedQuery}", Alasan: "${reason}", Saran query baru: "${newQuerySuggestion}"`
  );

  // Mengembalikan string yang akan dibaca oleh LLM.
  // String ini memberikan informasi yang jelas kepada LLM untuk mengambil langkah selanjutnya.
  return `Pencarian untuk "${failedQuery}" gagal karena "${reason}".
  Saran: Gunakan query yang disarankan: "${newQuerySuggestion}" untuk mencoba kembali.`;
};

const rephraseQueryFunctionTools = {
  rephraseQuery,
};

module.exports = rephraseQueryFunctionTools;
