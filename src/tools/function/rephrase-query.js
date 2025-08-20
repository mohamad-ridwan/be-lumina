const rephraseQuery = async ({ originalQuery, reason, newQuery }) => {
  // Tool ini sebenarnya tidak melakukan apa-apa, tapi berfungsi sebagai "sinyal" bagi LLM.
  // LLM akan melihat tool ini dipanggil dan akan menggunakannya untuk membuat tool_calls berikutnya.
  console.log(
    `Rephrase query called with originalQuery: "${originalQuery}", reason: "${reason}", newQuery: "${newQuery}"`
  );
  return `Query "${originalQuery}" gagal karena: ${reason}. Saran: Coba gunakan query baru: "${newQuery}"`;
};

const rephraseQueryFunctionTools = {
  rephraseQuery,
};

module.exports = rephraseQueryFunctionTools;
