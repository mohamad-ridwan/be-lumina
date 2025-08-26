const { JinaEmbeddings } = require("@langchain/community/embeddings/jina");

const embeddings = new JinaEmbeddings({
  apiKey: process.env.JINA_API_KEY_API_KEY, // Wajib diisi
  model: "jina-clip-v2",
});

const toolsEmbedding = new JinaEmbeddings({
  apiKey: process.env.JINA_API_KEY_API_KEY,
  model: "jina-embeddings-v2-small-en",
});

const getQueryVector = async (query, model = "product") => {
  try {
    const queryVector =
      model === "product"
        ? await embeddings.embedQuery(query)
        : await toolsEmbedding.embedQuery(query);
    return queryVector;
  } catch (error) {
    console.log("ERROR GET QUERY VECTOR FROM JINA EMBBEDING :", error);
    return null;
  }
};

module.exports = { getQueryVector };
