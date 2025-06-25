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

const processNewMessageWithAI = async (
  formattedHisory,
  message,
  sendMessageCallback,
  { io, socket, client, agenda }
) => {
  const latestMessageTimestamp = Date.now();
  const newMessageId = generateRandomId(15);
  try {
    const tools = await toolsDB.find();
    const chat = genAI.chats.create({
      model: "gemini-2.5-flash",
      //   history: formattedHisory,
      config: {
        tools: [{ functionDeclarations: tools }],
        // temperature: 0.5,
      },
    });
    const response = await chat.sendMessage({
      message: message.latestMessage.textMessage,
    });
    if (response.functionCalls && response.functionCalls.length > 0) {
      console.log("Gemini requested function call(s):", response.functionCalls);

      let functionCallResult;
      let responseText = "";
      let isMustUpdated = false;
      // Iterasi jika Gemini meminta lebih dari satu fungsi (jarang untuk kasus sederhana)
      for (const call of response.functionCalls) {
        const functionName = call.name;
        const functionArgs = call.args;

        if (availableFunctions[functionName]) {
          functionCallResult = await availableFunctions[functionName](
            ...Object.values(functionArgs)
          );
          console.log(
            `Function ${functionName} executed, result:`,
            functionCallResult
          );

          // Kirim hasil eksekusi fungsi kembali ke Gemini
          const toolResponseResult = await chat.sendMessage({
            message: {
              functionResponse: {
                name: functionName,
                response: functionCallResult,
              },
            },
          });

          // Ambil balasan AI yang sesungguhnya dari hasil toolResponse
          const finalAiResponseText = toolResponseResult.text;
          if (finalAiResponseText) {
            responseText += finalAiResponseText;
          }
          console.log("RESPONSE GENERATED TEXT AI", responseText);
          await sendMessageCallback(
            responseText,
            message,
            latestMessageTimestamp,
            { io, socket, client, agenda, newMessageId }
          );
          // await handleSendMessageFromAI(
          //   isMustUpdated,
          //   responseText,
          //   message,
          //   latestMessageTimestamp,
          //   { io, socket, client, agenda }
          // );
          isMustUpdated = true;
        }
      }
      return responseText;
    } else {
      await sendMessageCallback(
        response.text,
        message,
        latestMessageTimestamp,
        { io, socket, client, agenda, newMessageId }
      );
      // await handleSendMessageFromAI(
      //   false,
      //   response.text,
      //   message,
      //   latestMessageTimestamp,
      //   { io, socket, client, agenda }
      // );
      return response.text;
    }
  } catch (error) {
    console.error("Error processing new message with AI:", error);
    await sendMessageCallback(null, message, latestMessageTimestamp, {
      io,
      socket,
      client,
      agenda,
      newMessageId,
    });
    return error;
  }
};

module.exports = { getConversationHistoryForGemini, processNewMessageWithAI };
