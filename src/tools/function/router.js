const routeConversationFunc = async ({ tool_name, description }) => {
  console.log(
    `Router tool dipanggil. Keputusan: ${tool_name}, Deskripsi: ${description}`
  );

  // Buat output dalam format yang mudah dibaca oleh LangGraph
  // dan model LLM selanjutnya (jika dibutuhkan).
  const output = {
    decision: tool_name,
    reason: description,
    message: `Aksi yang harus dijalankan: ${tool_name}. Niat pengguna: ${description}`,
  };

  // Mengembalikan objek yang akan menjadi konten dari ToolMessage.
  // Ini adalah format standar untuk berkomunikasi antara node.
  return {
    content: JSON.stringify(output),
  };
};

const clarificationFunc = async ({ userIntent }) => {
  console.log(`Clarification tool dipanggil, niat: ${userIntent}`);
  // Mengembalikan sinyal ke LangGraph. Output ini akan menjadi bagian dari ToolMessage.
  return {
    content: JSON.stringify({
      status: "clarification_needed",
      message: `Pengguna membutuhkan klarifikasi. Niat: ${userIntent}`,
    }),
  };
};

const endConversationFunc = async ({ userIntent }) => {
  console.log(`End conversation tool dipanggil, niat: ${userIntent}`);
  // Mengembalikan sinyal ke LangGraph.
  return {
    content: JSON.stringify({
      status: "conversation_ended",
      message: `Percakapan berakhir. Niat: ${userIntent}`,
    }),
  };
};

module.exports = {
  routeConversationFunc,
  clarificationFunc,
  endConversationFunc,
};
