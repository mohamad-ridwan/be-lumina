const { JinaEmbeddings } = require("@langchain/community/embeddings/jina");

const embeddings = new JinaEmbeddings({
  apiKey: process.env.JINA_API_KEY_API_KEY, // Wajib diisi
  model: "jina-clip-v2",
});

const getQueryVector = async (query) => {
  try {
    const queryVector = await embeddings.embedQuery(query);
    return queryVector;
  } catch (error) {
    console.log("ERROR GET QUERY VECTOR FROM JINA EMBBEDING :", error);
    return null;
  }
};

module.exports = { getQueryVector };
