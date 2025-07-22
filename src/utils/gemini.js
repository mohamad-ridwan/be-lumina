const chatRoomDB = require("../models/chatRoom");
const toolsDB = require("../models/tools");
const genAI = require("../services/gemini");
// const availableTools = require("../tools/productTools");
const { availableFunctionProducts } = require("../services/product");
const { generateRandomId } = require("../helpers/generateRandomId");

const exampleTextHistoryData = `Tentu, saya akan bantu Anda mencari sepatu lari yang didesain untuk mengurangi kepanasan saat cuaca terik matahari! Berdasarkan pencarian saya, berikut beberapa rekomendasi sepatu lari dari Lumina yang memiliki fitur *breathable* atau material yang cocok untuk cuaca panas:\n\n<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">\n  <p style="margin-bottom: 10px;">Berikut adalah beberapa pilihan sepatu lari yang cocok untuk cuaca terik:</p>\n  <ul style="list-style-type: disc; margin-left: 20px; padding: 0;">\n    <li>\n      <strong style="color: #0056b3;">Adidas UltraBoost 23</strong>\n      <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">\n        <li><span style="font-weight: bold;">Deskripsi:</span> Sepatu lari inovatif dengan desain ringan dan <span style="font-weight: bold; color: #d9534f;"><i>breathable</i></span> untuk kenyamanan maksimal.</li>\n        <li><span style="font-weight: bold;">Harga:</span> Rp 2.500.000</li>\n        <li><span style="font-weight: bold;">Stok:</span> 150</li>\n      </ul>\n    </li>\n    <li style="margin-top: 10px;">\n      <strong style="color: #0056b3;">Puma ForeverRun NITRO</strong>\n      <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">\n        <li><span style="font-weight: bold;">Deskripsi:</span> Dilengkapi dengan <span style="font-weight: bold; color: #d9534f;"><i>engineered mesh upper</i></span> yang memastikan <span style="font-weight: bold; color: #d9534f;"><i>fit</i></span> yang aman dan <span style="font-weight: bold; color: #d9534f;"><i>breathable</i></span> untuk lari jarak jauh.</li>\n        <li><span style="font-weight: bold;">Harga:</span> Rp 2.300.000</li>\n        <li><span style="font-weight: bold;">Stok:</span> 70</li>\n      </ul>\n    </li>\n    <li style="margin-top: 10px;">\n      <strong style="color: #0056b3;">Adidas Duramo SL</strong>\n      <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">\n        <li><span style="font-weight: bold;">Deskripsi:</span> Memiliki <span style="font-weight: bold; color: #d9534f;"><i>upper mesh yang breathable</i></span> untuk sirkulasi udara optimal, menjaga kaki tetap sejuk.</li>\n        <li><span style="font-weight: bold;">Harga:</span> Rp 899.000</li>\n        <li><span style="font-weight: bold;">Stok:</span> 180</li>\n      </ul>\n    </li>\n    <li style="margin-top: 10px;">\n      <strong style="color: #0056b3;">New Balance Fresh Foam X More v4</strong>\n      <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">\n        <li><span style="font-weight: bold;">Deskripsi:</span> Dengan <span style="font-weight: bold; color: #d9534f;"><i>upper mesh yang lembut dan engineered</i></span> memberikan <span style="font-weight: bold; color: #d9534f;"><i>fit</i></span> yang suportif dan <span style="font-weight: bold; color: #d9534f;"><i>breathable</i></span>.</li>\n        <li><span style="font-weight: bold;">Harga:</span> Rp 2.100.000</li>\n        <li><span style="font-weight: bold;">Stok:</span> 95</li>\n      </ul>\n    </li>\n    <li style="margin-top: 10px;">\n      <strong style="color: #0056b3;">Adidas Ultraboost DNA</strong>\n      <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">\n        <li><span style="font-weight: bold;">Deskripsi:</span> Dengan <span style="font-weight: bold; color: #d9534f;"><i>upper Primeknit yang adaptif</i></span>, memberikan kenyamanan superior dan pengembalian energi di setiap langkah.</li>\n        <li><span style="font-weight: bold;">Harga:</span> Rp 2.750.000</li>\n        <li><span style="font-weight: bold;">Stok:</span> 65</li>\n      </ul>\n    </li>\n  </ul>\n  <p style="margin-top: 15px;">\n    Sepatu-sepatu ini umumnya menggunakan material <strong style="color: #d9534f;"><i>mesh</i></strong> atau <strong style="color: #d9534f;"><i>Primeknit</i></strong> pada bagian <i>upper</i>-nya yang dikenal sangat baik dalam sirkulasi udara, sehingga membantu mengurangi panas dan menjaga kaki tetap sejuk saat lari di bawah terik matahari.\n  </p>\n  <p style="margin-top: 10px;">\n    Apakah ada pertanyaan lain atau ingin saya bantu mencarikan model lain?\n  </p>\n</div>
`;

const exampleHistoryData = {
  parts: [
    {
      text: exampleTextHistoryData,
      function_response: {
        name: "searchShoes",
        response: [
          {
            name: "Sepatu Lari UltraBoost 23",
            brand: "Adidas",
            category:
              '["{\\"name\\":\\"Olahraga\\",\\"isPopular\\":false}","{\\"name\\":\\"Lari\\",\\"isPopular\\":true}"]',
            image:
              "https://images.unsplash.com/photo-1508609349937-5ec4ae374ebf?q=80&w=1518&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
            description:
              "Sepatu lari inovatif dengan bantalan responsif yang optimal untuk performa lari jarak jauh. Desain ringan dan breathable memberikan kenyamanan maksimal di setiap langkah. Cocok untuk pelari profesional maupun harian.",
            price_info: "Rp 2.500.000",
            total_stock: 150,
          },
          {
            name: "Puma ForeverRun NITRO",
            brand: "Puma",
            category:
              '["{\\"name\\":\\"Lari\\",\\"isPopular\\":true}","{\\"name\\":\\"Olahraga\\",\\"isPopular\\":false}"]',
            image:
              "https://images.unsplash.com/photo-1715003132895-b10a23d3c90f?q=80&w=2532&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
            description:
              "Puma ForeverRun NITRO dirancang untuk pelari yang mencari stabilitas dan bantalan maksimal. Sepatu ini dilengkapi dengan **bantalan busa NITRO Infused** di seluruh midsole, memberikan responsivitas dan kenyamanan luar biasa tanpa mengorbank dukungan. Desainnya yang adaptif dan *engineered mesh upper* memastikan *fit* yang aman dan *breathable* untuk lari jarak jauh.",
            price_info: "Rp 2.300.000",
            total_stock: 70,
          },
          {
            name: "Adidas Duramo SL",
            brand: "Adidas",
            category:
              '["{\\"name\\":\\"Lari\\",\\"isPopular\\":true}","{\\"name\\":\\"Olahraga\\",\\"isPopular\\":false}"]',
            image:
              "https://images.unsplash.com/photo-1572710376280-23712329d51d?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
            description:
              "Adidas Duramo SL adalah sepatu lari serbaguna yang dirancang untuk kenyamanan harian. Dibangun dengan **bantalan Lightmotion** yang ringan dan responsif, sepatu ini memberikan pijakan yang empuk dan fleksibel di setiap langkah. Upper mesh yang *breathable* memastikan sirkulasi udara optimal, menjaga kaki tetap sejuk. Ideal untuk lari jarak pendek, nge-gym, atau aktivitas sehari-hari.",
            price_info: "Rp 899.000",
            total_stock: 180,
          },
          {
            name: "New Balance Fresh Foam X More v4",
            brand: "New Balance",
            category:
              '["{\\"name\\":\\"Lari\\",\\"isPopular\\":true}","{\\"name\\":\\"Olahraga\\",\\"isPopular\\":false}"]',
            image:
              "https://images.unsplash.com/photo-1465453869711-7e174808ace9?q=80&w=1752&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
            description:
              "New Balance Fresh Foam X More v4 adalah sepatu lari dengan bantalan paling empuk di lini Fresh Foam X. Sepatu ini memiliki **midsole Fresh Foam X yang tebal** untuk penyerapan benturan maksimal dan kenyamanan superior selama lari jarak jauh. Upper mesh yang lembut dan *engineered* memberikan *fit* yang suportif dan *breathable*. Sempurna untuk lari pemulihan atau latihan harian yang membutuhkan bantalan ekstra.",
            price_info: "Rp 2.100.000",
            total_stock: 95,
          },
          {
            name: "Adidas Ultraboost DNA",
            brand: "Adidas",
            category:
              '["{\\"name\\":\\"Lari\\",\\"isPopular\\":true}","{\\"name\\":\\"Olahraga\\",\\"isPopular\\":false}"]',
            image:
              "https://images.unsplash.com/photo-1667668049170-51781ab56452?q=80&w=1548&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
            description:
              "Sepatu lari Adidas Ultraboost DNA adalah perpaduan sempurna antara performa dan gaya. Dengan bantalan Boost yang responsif dan upper Primeknit yang adaptif, memberikan kenyamanan superior dan pengembalian energi di setiap langkah. Ideal untuk latihan harian maupun gaya hidup aktif.",
            price_info: "Rp 2.750.000",
            total_stock: 65,
          },
        ],
      },
    },
  ],
};

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
      // senderUserId: recipientProfileId,
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
      { $limit: 10 },
    ]);

    if (messages.length === 0) {
      return [];
    }

    const formattedHisory = messages.map((msg) => {
      const productDataCurrently =
        msg?.productData?.length > 0 ? msg.productData : [];
      let function_response = undefined;
      if (productDataCurrently.length > 0 && msg.role === "model") {
        function_response = {
          name: "searchShoes",
          response: { productData: productDataCurrently },
        };
      } else if (msg.role === "model") {
        function_response = {
          name: "searchShoes",
          response: { productData: [] },
        };
      }
      let parts = [
        {
          text: msg.textMessage,
        },
      ];

      if (function_response) {
        parts.push({
          function_response: function_response,
        });
      }
      return {
        role: msg.role,
        parts: [
          {
            text: msg.textMessage,
            function_response: function_response,
          },
        ],
      };
    });

    console.log("Formatted history for Gemini:", formattedHisory);

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

// const instructionPrompt = `
// Anda adalah asisten layanan pelanggan (CS) untuk 'Sneaker Haven', toko sepatu online. Tugas utama Anda adalah membantu pelanggan dengan pertanyaan terkait stok produk, harga, informasi pesanan (status, pelacakan, pengembalian), dan kebijakan toko. Tanggapi dengan nada ramah, membantu, dan informatif. Jika Anda tidak memiliki informasi yang spesifik (misalnya, nomor pesanan tertentu atau detail akun), instruksikan pelanggan untuk memeriksa email konfirmasi mereka atau menghubungi dukungan manusia.
// `;

const siText1 = {
  text: `Anda adalah asisten layanan pelanggan (CS) untuk 'Lumina', toko sepatu online. Tugas utama Anda adalah membantu pelanggan dengan pertanyaan terkait stok produk, harga, informasi pesanan (status, pelacakan, pengembalian), dan kebijakan toko. Tanggapi dengan nada ramah, membantu, dan informatif. Jika Anda tidak memiliki informasi yang spesifik (misalnya, nomor pesanan tertentu atau detail akun), instruksikan pelanggan untuk memeriksa email konfirmasi mereka atau menghubungi dukungan manusia.`,
};
const siText2 = {
  text: `Anda adalah asisten pencarian sepatu yang ahli. Tugas Anda adalah menggunakan alat pencarian canggih untuk menemukan produk sepatu yang paling sesuai dengan kebutuhan pengguna. Alat ini juga dapat memberikan solusi matematika untuk harga atau jumlah produk sesuai pertanyaan atau kebutuhan pengguna.`,
};
const siText3 = {
  text: `Anda adalah seorang ahli pengklasifikasi sepatu. Tugas Anda adalah menganalisis pertanyaan pengguna dan memberikan kategori sepatu yang paling tepat berdasarkan makna pertanyaan tersebut.`,
};
const siText4 = {
  text: `Jika fungsi respon merupakan selain dari 'getOrderStatus' Anda adalah pengembang UI yang berspesialisasi dalam menciptakan tampilan teks yang ramah pengguna dan mudah dibaca di aplikasi chat. Tujuan Anda adalah menyediakan cuplikan kode HTML dan CSS sebaris yang sederhana, efektif dan informatif, yang meningkatkan keterbacaan tanpa bergantung pada desain yang rumit atau skema warna tertentu. Maksimal fonts-size: 14px, jika Anda ingin memberikan ringkas mengenai daftar informasi data Anda dapat berikan list yang sederhana.
  
  Untuk list Anda bisa memberikan style <ul> element seperti :
    <ul style="list-style-type: disc; margin-left: 20px; padding: 0;"></ul>

    Jika memiliki list pada anaknya bisa menggunakan "list-style-type: circle;" pada <ul style="list-style-type: circle; margin-left: 20px; padding: 0;"> element anaknya.

    Anda wajib memberikan solusi yang paling akurat dan relevan, memuaskan sebagai asisten layanan pelanggan (CS) untuk 'Lumina'.
  `,
};
const siText5 = {
  text: `
  Anda adalah ahli dalam melakukan kalkulasi anggaran. Anda akan menerima pertanyaan dari pengguna dan informasi harga, dan Anda harus memberikan jawaban dengan format yang akan Anda tentukan.
  
  Anda wajib memberikan informasi jika ditanyakan mengenai kalkulasi, sisa budget dan range harga. Berikan informasi yang informatif menggunakan elemen html yang sederhana, seperti title dari maksud penjumlahan atau kalkulasi dan totalnya.`,
};
const orderStatusInstruction = {
  text: `
  jika fungsi respon merupakan "getOrderStatus" anda wajib memberikan inline style css ui dan html yang konsisten seperti contoh :

- Jika tersedia alamat jadikan dalam satu paragraph, namun pisahkan jika tersedia nama dan email, untuk style ini (font-size: 13px, color: #777).
- Jika tersedia URL order, berikan attribute (target="_blank") supaya browser membuka tab baru, untuk style ini (font-size: 13px, color: #0000FF).
- Jika status "Menunggu Pembayaran", berikan style (color: oklch(68.1% 0.162 75.834)).
- Jika status "Diproses", berikan style (color: oklch(54.6% 0.245 262.881)).

untuk list ini Anda wajib untuk tidak memberikan warna background dan border atau apapun itu seperti style card.

Untuk list Anda bisa memberikan style <ul> element seperti :
    <ul style="list-style-type: disc; margin-left: 20px; padding: 0;"></ul>

    Jika memiliki list pada anaknya bisa menggunakan "list-style-type: circle;" pada <ul style="list-style-type: circle; margin-left: 20px; padding: 0;"> element anaknya.`,
};

const exampleFunctionCallData = {
  functionCall: {
    name: "searchShoes",
    args: {
      category: "Sepatu lari",
      query:
        "sepatu lari yang bahannya dapat mengurangi kepanasan dari cuaca yang terik matahari",
    },
  },
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
  let orderForFrontendData = [];
  let combinedResponseText = "";
  // Set untuk melacak ID produk yang sudah dikumpulkan secara keseluruhan
  const collectedProductIds = new Set();
  const collectedOrderIds = new Set();

  try {
    const tools = await toolsDB.find();
    const chat = genAI.chats.create({
      model: "gemini-2.5-flash",
      // config: {
      //   tools: [{ functionDeclarations: tools }],
      //   thinkingConfig: {
      //     thinkingBudget: 1024,
      //   },
      //   systemInstruction: {
      //     parts: [siText1, siText2, siText3, siText4, siText5],
      //     role: "model",
      //   },
      // },
      history: formattedHisory?.length > 0 ? formattedHisory : undefined,
    });

    const response = await chat.sendMessage({
      message: message.latestMessage.textMessage,
      config: {
        tools: [{ functionDeclarations: tools }],
        thinkingConfig: {
          thinkingBudget: 1024,
        },
        systemInstruction: {
          parts: [
            siText1,
            siText2,
            siText3,
            siText4,
            siText5,
            orderStatusInstruction,
          ],
          role: "model",
        },
      },
    });

    console.log("Gemini requested function call(s):", response.functionCalls);

    let indexCount = 0;

    if (response.functionCalls && response.functionCalls.length > 0) {
      const functionCallResultsForGemini = [];

      for (const call of response.functionCalls) {
        const functionName = call.name;
        const functionArgs = { ...call.args }; // Salin argumen
        const geminiResult = { shoes: [] };

        if (functionName === "searchShoes") {
          functionArgs.excludeIds = Array.from(collectedProductIds);
        }
        if (functionName === "getOrderStatus") {
          functionArgs.excludeOrderIds = Array.from(collectedOrderIds);
        }

        if (availableFunctionProducts[functionName]) {
          const resultFromTool = await availableFunctionProducts[functionName](
            functionArgs
          );
          console.log("Function call result:", resultFromTool);
          if (functionName === "searchShoes") {
            console.log(
              "result database from tool 'searchShoes':",
              resultFromTool?.shoes
            );
          }

          indexCount += 1;

          if (
            functionName === "searchShoes" &&
            resultFromTool &&
            resultFromTool?.productsForFrontend
          ) {
            resultFromTool.productsForFrontend.forEach((product) => {
              const id = product._id?.toString();
              if (id && !collectedProductIds.has(id)) {
                accumulatedProductsForFrontend.push(product);
                collectedProductIds.add(id); // Tambahkan ID ke set global
              }
            });
            geminiResult.shoes = resultFromTool.shoes;
            if (resultFromTool.message) {
              geminiResult.message = resultFromTool.message;
            }
            functionCallResultsForGemini.push({
              name: functionName,
              response: { productData: resultFromTool.shoes },
            });
          } else if (
            functionName === "getOrderStatus" &&
            resultFromTool?.length > 0
          ) {
            resultFromTool.forEach((order) => {
              const id = order._id?.toString();
              if (id && !collectedOrderIds.has(id)) {
                orderForFrontendData.push(order);
                collectedOrderIds.add(id); // Tambahkan ID ke set global
              }
            });
            geminiResult.orders = resultFromTool;
            functionCallResultsForGemini.push({
              name: functionName,
              response: { orderData: resultFromTool },
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
      console.log("tools response parts: ", toolResponseParts);

      const toolResponseResult = await chat.sendMessage({
        message: toolResponseParts,
        config: {
          systemInstruction: {
            parts: [
              siText1,
              siText2,
              siText3,
              siText4,
              siText5,
              orderStatusInstruction,
            ],
            role: "model",
          },
        },
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
          orderData: orderForFrontendData, // Kirimkan data order unik
        }
      );

      return combinedResponseText;
    } else {
      console.log("single response without function calls:");
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
          orderData: [],
        }
      );
      return response.text;
    }
  } catch (error) {
    console.error("Error processing new message with AI:", error);
    await sendMessageCallback(
      "Maaf, kami tidak tersedia saat ini. Silakan coba lagi.",
      message,
      latestMessageTimestamp,
      {
        io,
        socket,
        client,
        agenda,
        newMessageId,
        productData: [],
        orderData: [],
      }
    );
    return error;
  }
};

module.exports = { getConversationHistoryForGemini, processNewMessageWithAI };
