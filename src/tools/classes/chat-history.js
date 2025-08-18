const { BaseChatMessageHistory } = require("@langchain/core/chat_history");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
const ChatRoom = require("../../models/chatRoom");

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

    const messages = await ChatRoom.aggregate([
      { $match: queryConditions },
      {
        $addFields: {
          // Membuat field 'sortTimestamp'
          sortTimestamp: getSortTimestampField(),
        },
      },
      { $sort: { sortTimestamp: -1 } }, // Urutkan berdasarkan sortTimestamp yang baru dibuat
      { $limit: 50 },
    ]);

    if (messages.length === 0) {
      return [];
    }

    const formattedHisory = messages
      .sort((a, b) => a.sortTimestamp - b.sortTimestamp)
      .map((msg) => {
        if (msg.role === "user") {
          return new HumanMessage(msg.textMessage);
        } else if (msg?.productData?.length > 0) {
          return new AIMessage({
            content: msg.textMessage,
            additional_kwargs: {
              data: msg?.productData,
            },
          });
        }
        return new AIMessage(msg.textMessage);
      });

    return formattedHisory;
  } catch (error) {
    console.error("Error fetching conversation history for Gemini:", error);
  }
};

class MongooseChatHistory extends BaseChatMessageHistory {
  constructor(messageId, message) {
    super();
    this.messageId = messageId;
    this.message = message;
  }

  // Metode untuk mengambil riwayat dari database
  async getMessages() {
    const messages = await getConversationHistoryForGemini(this.message);

    // Konversi dokumen Mongoose menjadi format LangChain
    return messages;
  }

  // Metode untuk menyimpan pesan baru ke database
  async addMessage(message) {
    const { type, content } = message;
    console.log("Call addMessage", type, content);
    return;
    // const role = type === "human" ? "user" : "model";
    // const newMessage = new ChatRoom({
    //   messageId: this.messageId,
    //   role: role,
    //   textMessage: content,
    // });
    // await newMessage.save();
  }
}

module.exports = { MongooseChatHistory };
