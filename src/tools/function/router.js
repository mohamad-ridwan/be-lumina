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

module.exports = {
  routeConversationFunc,
};
