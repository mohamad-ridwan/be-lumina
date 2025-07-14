const chatRoomDB = require("../models/chatRoom");
const toolsDB = require("../models/tools");
const genAI = require("../services/gemini");
// const availableTools = require("../tools/productTools");
const { availableFunctions } = require("../services/product");
const { generateRandomId } = require("../helpers/generateRandomId");

const getConversationHistoryForGemini = async (message, io, socket, client) => {
  try {
    const { latestMessage, isNeedHeaderDate, recipientProfileId } = message;

    const chatRoomId = message?.chatRoomId;
    const chatId = message?.chatId;
    const senderUserId = latestMessage?.senderUserId;

    const queryMediaOnProgress = {
      $and: [
        { senderUserId: { $ne: senderUserId } }, // senderUserId BUKAN senderUserId saat ini
        { "document.isProgressDone": false }, // document.isProgressDone adalah true
      ],
    };
    const queryMediaOnCancelled = {
      $and: [
        { senderUserId: { $ne: senderUserId } }, // senderUserId BUKAN senderUserId saat ini
        { "document.isCancelled": true }, // document.isProgressDone adalah true
      ],
    };

    const getSortTimestampField = () => {
      return {
        $cond: {
          if: {
            $and: [
              { $ne: ["$senderUserId", senderUserId] }, // Jika senderUserId BUKAN senderUserId
              { $ne: ["$completionTimestamp", null] }, // DAN completionTimestamp tidak null
            ],
          },
          then: { $toDouble: "$completionTimestamp" }, // Gunakan completionTimestamp
          else: { $toDouble: "$latestMessageTimestamp" }, // Jika tidak, gunakan latestMessageTimestamp
        },
      };
    };

    const queryConditions = {
      chatId,
      chatRoomId,
      senderUserId: recipientProfileId,
      messageType: "text",
      // $nor array sekarang berisi dua kondisi pengecualian
      $nor: [
        // Kondisi 1: Pengecualian pesan yang dihapus oleh profileId saat ini
        {
          isDeleted: {
            $elemMatch: {
              senderUserId: senderUserId,
              deletionType: { $in: ["me", "permanent"] },
            },
          },
        },
        {
          isDeleted: {
            $elemMatch: {
              senderUserId: recipientProfileId,
              deletionType: { $in: ["everyone", "permanent"] },
            },
          },
        },
        // Kondisi 2: Pengecualian pesan yang BUKAN dari profileId saat ini,
        //           DAN isProgressDone: true, DAN isCancelled: false
        queryMediaOnProgress,
        queryMediaOnCancelled,
      ],
    };

    const messages = await chatRoomDB.aggregate([
      { $match: queryConditions },
      {
        $addFields: {
          // Membuat field 'sortTimestamp'
          sortTimestamp: getSortTimestampField(),
        },
      },
      { $sort: { sortTimestamp: -1 } }, // Urutkan berdasarkan sortTimestamp yang baru dibuat
      { $limit: 1 },
    ]);

    if (messages.length === 0) {
      return [];
    }

    const formattedHisory = messages.map((msg) => ({
      role: "user",
      parts: [{ text: msg.textMessage }],
    }));

    return formattedHisory;
  } catch (error) {
    console.error("Error fetching conversation history for Gemini:", error);
  }
};

const setProductDataForFrontend = (functionCallResult, functionName) => {
  let productDataForFrontend = [];
  if (
    functionCallResult.status === "success" ||
    functionCallResult.status === "multiple_results"
  ) {
    if (
      functionName === "getProductPrice" ||
      functionName === "checkProductStock"
    ) {
      const productsArray = functionCallResult.products
        ? functionCallResult.products
        : [functionCallResult];

      productsArray.forEach((p) => {
        productDataForFrontend.push({
          type: "product_card", // Menandakan ini adalah data untuk kartu produk
          data: {
            name: p.productName,
            brand: p.brand,
            variant: p.variant,
            size: p.size,
            stock: p.stock,
            quantity: p.quantity,
            price: p.price,
            currency: p.currency,
            category: p.category,
            image: p?.image ?? null,
            // Anda bisa menambahkan URL gambar di sini jika ada di data DB
            // imageUrl: p.imageUrl
          },
        });
      });
    } else if (functionName === "getAvailableBrands") {
      // Untuk tool yang mengembalikan daftar merek
      functionCallResult.brands.forEach((b) => {
        productDataForFrontend.push({
          type: "brand_image", // Menandakan ini adalah data untuk gambar brand
          data: {
            brandName: b,
            // imageUrl: getBrandImageUrl(b) // Fungsi pembantu untuk mendapatkan URL gambar brand
          },
        });
      });
    }
  }

  return productDataForFrontend;
};

// const instructionPrompt = `
// AI diwajibkan untuk menjawab pertanyaan yang singkat dan juga menyimpulkan pertanyaan yang jelas sesuai data yang di dapatkan.
// AI juga diwajibkan untuk memberikan list jika ada data produk yang relevan dan tidak duplikasi.
// Jika ada data variant diwajibkan memberikan semua variant yang sesuai ditanyakan di setiap product tersebut. Dan jika tidak ada pertanyaan mengenai variant, wajib memberikan semua variant di setiap product tersebut.
// Format list produk harus menggunakan elemen HTML:
// <ul style="padding-top:10px; display:flex; flex-direction:column; gap:10px;">
//   <li style="list-style:none;">
//     <b style="font-size:13px;">[Nama Produk]</b><br>
//     <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">
//       <span style="background-color:#000; color:#fff; padding:2px 6px; border-radius:500px; font-size:11px; display:flex; align-items:center; gap:3px;">
//         <span style="font-weight:600;">[Nama Atribut Varian 1, misal: Warna]:</span>
//         <span style="font-weight:normal;">[Nilai Varian 1, misal: Core Black]</span>
//       </span>
//       <span style="background-color:#000; color:#fff; padding:2px 6px; border-radius:500px; font-size:11px; display:flex; align-items:center; gap:3px;">
//         <span style="font-weight:600;">[Nama Atribut Varian 2, misal: Ukuran]:</span>
//         <span style="font-weight:normal;">[Nilai Varian 2, misal: 40]</span>
//       </span>
//       </div>
//     <span style="font-size:11.9px; font-weight:normal; display:block; margin-top:5px;">[Deskripsi singkat produk, maksimal 2-3 kalimat yang relevan dengan pertanyaan awal]</span>
//     <span style="font-weight:bold; font-size:11.9px;">Harga: [Informasi Rentang Harga Produk atau Harga Tunggal]</span>
//   </li>
//   </ul>
//   Jangan berikan padding-top: 10px; di <ul> jika di atasnya tidak ada konten.
// Jangan berikan gambar, jangan berikan logic bahasa pemrograman, dan jangan berikan card background. Jangan berikan harga per varian, cukup rentang harga keseluruhan produk di bagian bawah deskripsi. Jika product tidak ada variant, tolong jangan berikan variant.
// Jangan berikan data yang duplikasi, jika ada data yang belum selesai untuk di generate text, wajib generate data sesuai yang baru.

// Jika tidak ada produk, berikan respons maaf yang singkat.
// `;

const instructionPrompt = `
Anda adalah asisten layanan pelanggan (CS) untuk 'Sneaker Haven', toko sepatu online. Tugas utama Anda adalah membantu pelanggan dengan pertanyaan terkait stok produk, harga, informasi pesanan (status, pelacakan, pengembalian), dan kebijakan toko. Tanggapi dengan nada ramah, membantu, dan informatif. Jika Anda tidak memiliki informasi yang spesifik (misalnya, nomor pesanan tertentu atau detail akun), instruksikan pelanggan untuk memeriksa email konfirmasi mereka atau menghubungi dukungan manusia.
`;

const siText1 = {
  text: `Anda adalah asisten layanan pelanggan (CS) untuk 'Sneaker Haven', toko sepatu online. Tugas utama Anda adalah membantu pelanggan dengan pertanyaan terkait stok produk, harga, informasi pesanan (status, pelacakan, pengembalian), dan kebijakan toko. Tanggapi dengan nada ramah, membantu, dan informatif. Jika Anda tidak memiliki informasi yang spesifik (misalnya, nomor pesanan tertentu atau detail akun), instruksikan pelanggan untuk memeriksa email konfirmasi mereka atau menghubungi dukungan manusia.`,
};
const siText2 = {
  text: `Anda adalah asisten pencarian sepatu yang ahli. Tugas Anda adalah menggunakan alat pencarian canggih untuk menemukan produk sepatu yang paling sesuai dengan kebutuhan pengguna. Alat ini juga dapat memberikan solusi matematika untuk harga atau jumlah produk sesuai pertanyaan atau kebutuhan pengguna.`,
};
const siText3 = {
  text: `Anda adalah seorang ahli pengklasifikasi sepatu. Tugas Anda adalah menganalisis pertanyaan pengguna dan memberikan kategori sepatu yang paling tepat berdasarkan makna pertanyaan tersebut.`,
};

// const instructionPrompt = `
// AI diwajibkan untuk menjawab pertanyaan yang singkat dan juga menyimpulkan pertanyaan yang jelas sesuai dari data yang di berikan, seperti kecocokan antara pertanyaan dengan field value dari name, price, brand, category, description, price_info, total_stock.

// AI diwajibkan memberikan solusi yang akurat dan nyambung jika data produk yang dicari tidak ada atau tidak sesuai dengan kriteria pengguna.

// Berikan respons ketersediaan produk yang singkat, jangan menjelaskan nama, harga, variant produk yang ada.

// Jika tidak ada produk, berikan respons maaf yang singkat.
// `;

const processNewMessageWithAI = async (
  formattedHisory,
  message,
  sendMessageCallback,
  { io, socket, client, agenda }
) => {
  const latestMessageTimestamp = Date.now();
  const newMessageId = generateRandomId(15);
  let accumulatedProductsForFrontend = [];
  let combinedResponseText = "";
  // Set untuk melacak ID produk yang sudah dikumpulkan secara keseluruhan
  const collectedProductIds = new Set();

  try {
    const tools = await toolsDB.find();
    const chat = genAI.chats.create({
      model: "gemini-2.5-flash",
      config: {
        tools: [{ functionDeclarations: tools }],
        thinkingConfig: {
          thinkingBudget: 1024,
        },
        systemInstruction: {
          parts: [siText1, siText2, siText3],
        },
      },
      // history: [
      //   {
      //     parts: [
      //       {
      //         text: instructionPrompt,
      //       },
      //     ],
      //     role: "model",
      //   },
      // ],
    });

    const response = await chat.sendMessage({
      message: message.latestMessage.textMessage,
    });

    console.log("Gemini requested function call(s):", response.functionCalls);

    let indexCount = 0;

    if (response.functionCalls && response.functionCalls.length > 0) {
      const functionCallResultsForGemini = [];

      for (const call of response.functionCalls) {
        const functionName = call.name;
        const functionArgs = { ...call.args }; // Salin argumen

        // <<< LOGIKA PENTING DI SINI >>>
        // Tambahkan ID yang sudah dikumpulkan ke parameter excludeIds
        if (functionName === "searchShoes") {
          functionArgs.excludeIds = Array.from(collectedProductIds);
        }
        // <<< AKHIR LOGIKA PENTING >>>

        if (availableFunctions[functionName]) {
          const resultFromTool = await availableFunctions[functionName](
            functionArgs
          );
          console.log("result database from tool:", resultFromTool.shoes);
          console.log(
            "result category product from tool:",
            resultFromTool.shoes?.[indexCount]?.category
          );
          indexCount += 1;

          if (resultFromTool && resultFromTool.productsForFrontend) {
            resultFromTool.productsForFrontend.forEach((product) => {
              const id = product._id?.toString();
              if (id && !collectedProductIds.has(id)) {
                accumulatedProductsForFrontend.push(product);
                collectedProductIds.add(id); // Tambahkan ID ke set global
              }
            });

            const geminiResult = { shoes: resultFromTool.shoes };
            if (resultFromTool.message) {
              geminiResult.message = resultFromTool.message;
            }
            functionCallResultsForGemini.push({
              name: functionName,
              response: geminiResult,
            });
          } else {
            functionCallResultsForGemini.push({
              name: functionName,
              response: resultFromTool,
            });
          }
        } else {
          console.warn(
            `Function ${functionName} is declared but not implemented in availableFunctions.`
          );
          combinedResponseText += `Maaf, ada masalah dalam memproses permintaan Anda (fungsi '${functionName}' tidak ditemukan). `;
        }
      }

      const toolResponseParts = functionCallResultsForGemini.map((result) => ({
        functionResponse: result,
      }));

      const toolResponseResult = await chat.sendMessage({
        message: toolResponseParts,
      });

      const finalAiResponseText = toolResponseResult.text;
      if (finalAiResponseText) {
        combinedResponseText = finalAiResponseText;
      }

      console.log("FINAL GENERATED TEXT AI:", combinedResponseText);

      await sendMessageCallback(
        combinedResponseText,
        message,
        latestMessageTimestamp,
        {
          io,
          socket,
          client,
          agenda,
          newMessageId,
          productData: accumulatedProductsForFrontend, // Kirimkan data produk unik
        }
      );

      return combinedResponseText;
    } else {
      console.log("single response without function calls:", response.text);
      await sendMessageCallback(
        response.text,
        message,
        latestMessageTimestamp,
        {
          io,
          socket,
          client,
          agenda,
          newMessageId,
          productData: [],
        }
      );
      return response.text;
    }
  } catch (error) {
    console.error("Error processing new message with AI:", error);
    await sendMessageCallback(
      "Maaf, terjadi kesalahan internal. Silakan coba lagi.",
      message,
      latestMessageTimestamp,
      {
        io,
        socket,
        client,
        agenda,
        newMessageId,
        productData: [],
      }
    );
    return error;
  }
};

module.exports = { getConversationHistoryForGemini, processNewMessageWithAI };
