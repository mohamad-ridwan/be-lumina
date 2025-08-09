const chatRoomDB = require("../models/chatRoom");
const Category = require("../models/category");
const Brand = require("../models/brand");
const toolsDB = require("../models/tools");
const genAI = require("../services/gemini");
// const availableTools = require("../tools/productTools");
const { availableFunctionProducts } = require("../services/product");
const { generateRandomId } = require("../helpers/generateRandomId");
const {
  feedback_shoes_response,
  shoeAssistans,
  shoeClafirication,
  shoeCalculation,
  noResultShoeClarification,
} = require("./instructions/shoes");
const {
  orderStatusInstruction,
  confirmCancelOrderInstruction,
} = require("./instructions/orders");
const { ui_list_instruction } = require("./instructions/ui");
const {
  CSAssistans,
  CSCommunication,
  CSProductQuestions,
  CSProductCriteria,
  CSFunctionValidation,
  CSUserProductAudience,
  CSParameterValidation,
  CSProductRecommendation,
} = require("./instructions/assistans");
const { seasonCurrently } = require("./instructions/seasons");
const {
  generateDynamicInstruction,
  getConversationContext,
} = require("./instructions/bubble-messages");

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
      { $limit: 20 },
    ]);

    if (messages.length === 0) {
      return [];
    }

    const formattedHisory = messages
      .sort((a, b) => a.sortTimestamp - b.sortTimestamp)
      .map((msg) => {
        let parts = [{ text: msg.textMessage }];
        if (
          msg.role === "model" &&
          msg?.functionCall &&
          msg?.functionResponse
        ) {
          parts.push({
            functionCalls: msg.functionCall[0],
            functionResponse: msg?.functionResponse[0],
          });
        }

        return {
          role: msg.role,
          parts,
        };
      });

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
  let typeOrder = "";
  // Set untuk melacak ID produk yang sudah dikumpulkan secara keseluruhan
  const collectedProductIds = new Set();
  const collectedOrderIds = new Set();

  let userQuestions = message.latestMessage.textMessage;

  let functionCallForHistory = [];
  let functionResponseForHistory = [];
  let currentFunctionName = null;

  try {
    const tools = await toolsDB.find({ role: "assistans" });
    const category = await Category.find();
    const brands = await Brand.find();

    const chat = genAI.chats.create({
      model: "gemini-2.5-flash",
      history: formattedHisory?.length > 0 ? formattedHisory : undefined,
    });

    const response = await chat.sendMessage({
      message: userQuestions,
      config: {
        tools: [{ functionDeclarations: tools }],
        temperature: 1,
        thinkingConfig: {
          thinkingBudget: 1024,
        },
        systemInstruction: {
          parts: [
            CSAssistans,
            // SEASONS
            seasonCurrently,
            // END SEASONS
            ui_list_instruction,
            orderStatusInstruction,
            confirmCancelOrderInstruction,
            CSCommunication,
            CSProductQuestions(category, brands),
            CSProductRecommendation(category, brands),
            CSProductCriteria,
            CSFunctionValidation,
            CSUserProductAudience,
            CSParameterValidation,
          ],
          role: "model",
        },
      },
    });

    console.log("Gemini requested function call(s):", response.functionCalls);

    let functionCalls = [];
    if (response.functionCalls && response.functionCalls.length > 0) {
      functionCalls = response.functionCalls;
      functionCallForHistory = response.functionCalls;
      console.log("FUNCTION CALLS : ", response.functionCalls);
    }

    const mainResponseText = response.text;

    let indexCount = 0;

    if (functionCalls.length > 0) {
      const functionCallResultsForGemini = [];

      for (const call of functionCalls) {
        const functionName = call.name;
        const functionArgs = { ...call.args }; // Salin argumen
        const geminiResult = { shoes: [] };
        currentFunctionName = functionName;

        if (functionName === "searchShoes") {
          functionArgs.excludeIds = Array.from(collectedProductIds);
        }
        if (functionName === "requestCancelOrder") {
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
            functionName === "requestCancelOrder" &&
            resultFromTool?.length > 0
          ) {
            typeOrder = "requestCancelOrderData";
            resultFromTool.forEach((order) => {
              const id = order._id?.toString();
              if (id && !collectedOrderIds.has(id)) {
                orderForFrontendData.push(order);
                collectedOrderIds.add(id); // Tambahkan ID ke set global
              }
            });
            geminiResult.requestCancelOrderData = resultFromTool;
            functionCallResultsForGemini.push({
              name: functionName,
              response: { requestCancelOrderData: resultFromTool },
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

      if (functionCallResultsForGemini.length > 0) {
        functionResponseForHistory = functionCallResultsForGemini.filter(
          (item) =>
            item?.response?.productData?.length > 0 ||
            item?.response?.requestCancelOrderData?.length > 0
        );
      }

      let toolResponseResult = null;

      if (
        currentFunctionName === "searchShoes" &&
        toolResponseParts.length > 0 &&
        functionCallResultsForGemini[0]?.response?.productData?.length > 0
      ) {
        toolResponseResult = await chat.sendMessage({
          message: toolResponseParts,
          config: {
            systemInstruction: {
              parts: [
                shoeAssistans,
                shoeClafirication,
                ui_list_instruction,
                shoeCalculation,
                feedback_shoes_response,
              ],
              role: "model",
            },
          },
        });
        toolResponseResult = toolResponseResult.text;
      } else if (
        currentFunctionName === "searchShoes" &&
        toolResponseParts.length === 0 &&
        functionCallResultsForGemini[0]?.response?.productData?.length === 0
      ) {
        toolResponseResult = await chat.sendMessage({
          message: {
            text: "Maaf, kami tidak menemukan sepatu yang sesuai dengan kriteria Anda. Coba kata kunci lain atau perlonggar kriteria pencarian.",
          },
          config: {
            systemInstruction: {
              parts: [shoeAssistans, noResultShoeClarification],
              role: "model",
            },
          },
        });
        toolResponseResult = toolResponseResult.text;
      } else if (currentFunctionName && "requestCancelOrder") {
        toolResponseResult = await chat.sendMessage({
          message: toolResponseParts,
          config: {
            systemInstruction: {
              parts: [
                ui_list_instruction,
                orderStatusInstruction,
                confirmCancelOrderInstruction,
              ],
              role: "model",
            },
          },
        });
        toolResponseResult = toolResponseResult.text;
      }

      if (toolResponseResult) {
        combinedResponseText = toolResponseResult;
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
          productData: accumulatedProductsForFrontend,
          orderData: {
            loading: false,
            type: typeOrder,
            orders: orderForFrontendData,
            isConfirmed: false,
          }, // Kirimkan data order unik
        },
        functionCallForHistory,
        functionResponseForHistory
      );

      return combinedResponseText;
    } else {
      console.log("single response without function calls:");
      await sendMessageCallback(
        mainResponseText,
        message,
        latestMessageTimestamp,
        {
          io,
          socket,
          client,
          agenda,
          newMessageId,
          productData: [],
          orderData: {},
        }
      );
      return mainResponseText;
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
        orderData: {},
      }
    );
    return error;
  }
};

const generateQuestionsToBubbleMessages = async ({
  senderUserId,
  recipientProfileId,
  chatRoomId,
  chatId,
}) => {
  try {
    let history = [];
    const latestMessage = {
      senderUserId,
    };
    const getHistory = await getConversationHistoryForGemini({
      latestMessage,
      chatRoomId,
      chatId,
      recipientProfileId,
    });
    history = getHistory ?? [];

    const category = await Category.find();
    const brands = await Brand.find();

    const chat = genAI.chats.create({
      model: "gemini-2.5-flash-lite",
      history,
    });

    const tools = await toolsDB.find({ role: "bubble-messages" });

    // analisis percakapan (topik)
    // const historyString = history
    //   .map((h) => `${h?.role}: ${h?.parts?.[0]?.text}`)
    //   .join("\n");

    const extractionPrompt = `
  Analisis riwayat percakapan dan ekstrak informasi-informasi kunci ke dalam format JSON. Jika tidak ada informasi yang spesifik, gunakan "null".

  Format Output JSON:
  {
    "topik": "string | null",
    "user_intent": "string | null",
    "pertanyaan_terakhir_pelanggan": "string | null",
    "last_model_answer_summary": "string | null",
    "sepatu": [
      {
        "nama_sepatu": "string | null",
        "brand": "string | null",
        "kategori": "string[] | null",
        "keunggulan": "string[] | null",
        "fitur": "string[] | null",
        "warna": "string[] | null",
        "ukuran": "string[] | null",
        "audiens": "string[] | null"
      }
    ]
  }

  Tolong pastikan output Anda HANYA berupa string JSON yang valid, tanpa ada teks penjelasan atau markdown code block.

  JANGAN berikan data sepatu jika tidak ada data sepatu apapun dari riwayat percakapan yang disebutkan, berikan saja array kosong.
`;

    const contextResponse = await chat.sendMessage({
      message: extractionPrompt,
      config: {
        // Nonaktifkan tool di sini karena tujuannya hanya ekstraksi teks
        tools: [],
      },
    });

    const conversationContext = await getConversationContext(
      contextResponse.text
    );
    console.log("CONVERSATION CONTEXT DEBUG:", conversationContext);

    const dynamicInstruction = generateDynamicInstruction(
      conversationContext,
      category,
      brands
    );

    const response = await chat.sendMessage({
      message: `Berikan 5 pertanyaan rekomendasi "Pelanggan" ke "Layanan" dalam melanjutkan percakapan dia. Pertanyaan ini akan di realisasikan sebagai pemilik pertanyaan "Pelanggan"`, // Prompt bisa lebih sederhana
      config: {
        tools: [{ functionDeclarations: tools }],
        temperature: 1,
        thinkingConfig: {
          thinkingBudget: 1024,
        },
        systemInstruction: dynamicInstruction,
      },
    });

    let bubbleMessageQuestions = [];
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        const functionArgs = { ...call.args }; // Salin argumen

        if (functionArgs?.questions?.length > 0) {
          bubbleMessageQuestions = functionArgs.questions;
        }
      }
    }
    return bubbleMessageQuestions;
  } catch (error) {
    console.log("ERROR generate questions for bubble messages: ", error);
    return [];
  }
};

module.exports = {
  getConversationHistoryForGemini,
  processNewMessageWithAI,
  generateQuestionsToBubbleMessages,
};
