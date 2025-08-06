const toolsDB = require("../models/tools");

// Anda bisa menyimpan ini di file terpisah, misal: tools/productTools.js
// const tools = [
//   {
//     functionDeclarations: [
//       {
//         name: "getProductPrice",
//         description: "Mendapatkan harga sebuah produk berdasarkan nama produk.",
//         parameters: {
//           type: "OBJECT",
//           properties: {
//             productName: {
//               type: "STRING",
//               description: "Nama lengkap produk yang ingin dicari harganya.",
//             },
//           },
//           required: ["productName"],
//         },
//       },
//       {
//         name: "checkProductStock",
//         description:
//           "Mengecek ketersediaan stok produk berdasarkan nama produk.",
//         parameters: {
//           type: "OBJECT",
//           properties: {
//             productName: {
//               type: "STRING",
//               description: "Nama lengkap produk yang ingin dicek stoknya.",
//             },
//           },
//           required: ["productName"],
//         },
//       },
//       // Tambahkan definisi fungsi lain yang Anda miliki di backend
//     ],
//   },
// ];

const tools = async () => {
  try {
    const allTools = await toolsDB.find({ role: "assistans" });
    return allTools;
  } catch (error) {
    console.log("Error get tools : ", error);
    return [];
  }
};

module.exports = tools;
