const chatRoomDB = require("../models/chatRoom");
const chatsDB = require("../models/chats");
const usersDB = require("../models/users");
const Order = require("../models/order");
const mongoose = require("mongoose");
const dayjs = require("dayjs");
require("dayjs/locale/id");
const isToday = require("dayjs/plugin/isToday");
const isYesterday = require("dayjs/plugin/isYesterday");
const weekOfYear = require("dayjs/plugin/weekOfYear");
const weekday = require("dayjs/plugin/weekday");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { generateRandomId } = require("../helpers/generateRandomId");
const {
  isUserInRoom,
  getTodayHeader,
  findLatestMessageForUser,
  existingBotReplyMessageJob,
} = require("../helpers/general");
const {
  // processNewMessageWithAI,
  getConversationHistoryForGemini,
} = require("../utils/gemini");
const genAI = require("../services/gemini");
const { templateSendMessage } = require("../helpers/sendMessage");
const {
  agenda_name_sendMessageToCustomer,
  agenda_name_paymentNotifResponse,
  agenda_name_automaticOrderCancelOfProcessingStatus,
} = require("../utils/agenda");
const {
  automatedCancelOrderOfProcessingStatusTools,
} = require("../tools/order");
const { processNewMessageWithAI } = require("../services/ai/gemini.service");

dayjs.extend(isToday);
dayjs.extend(isYesterday);
dayjs.extend(weekOfYear);
dayjs.extend(weekday);
dayjs.extend(utc);
dayjs.extend(timezone);

dayjs.tz.setDefault("Asia/Jakarta");

const isThereMessageToday = async (chatId, chatRoomId) => {
  const todayStartUTC = dayjs()
    .tz("Asia/Jakarta")
    .startOf("day")
    .utc()
    .valueOf();
  const todayEndUTC = dayjs().tz("Asia/Jakarta").endOf("day").utc().valueOf();

  try {
    const existingMessageToday = await chatRoomDB.findOne({
      chatId,
      chatRoomId,
      latestMessageTimestamp: {
        $gte: todayStartUTC,
        $lte: todayEndUTC,
      },
      isHeader: { $ne: true }, // Optional: Exclude header messages if needed
    });
    return !!existingMessageToday;
  } catch (error) {
    console.error("Error checking for messages today:", error);
    return false;
  }
};

const handleDisconnected = (
  { chatRoomId, chatId, userId, socketId },
  client
) => {
  client.sRem(`chats:${chatId}:room:${chatRoomId}:users:${userId}`, socketId); // Hapus userId dari set Redis

  console.log(`User ${socketId} left room: ${chatRoomId} from disconnected`);
};

const markMessageAsRead = async (message, io) => {
  await chatRoomDB.updateOne(
    {
      chatRoomId: message?.chatRoomId,
      chatId: message?.chatId,
      messageId: message?.messageId,
    },
    { status: "READ" },
    { new: true }
  );

  io.emit("markMessageAsRead", message);
};

// const sendMessage = async (message, io, socket, client) => {
//     const newChatRoom = new chatRoomDB({
//         chatId: message?.chatId,
//         chatRoomId: message?.chatRoomId,
//         messageId: message?.latestMessage?.messageId,
//         senderUserId: message?.latestMessage?.senderUserId,
//         messageType: message?.latestMessage?.messageType,
//         textMessage: message?.latestMessage?.textMessage,
//         latestMessageTimestamp: message?.latestMessage?.latestMessageTimestamp,
//         status: message?.latestMessage?.status
//     })
//     await newChatRoom.save()

//     const chatsCurrently = await chatsDB.findOne({
//         chatRoomId: message?.chatRoomId,
//         chatId: message?.chatId
//     })

//     const secondUserId = Object?.keys(chatsCurrently?.unreadCount)?.filter(id => id !== message?.latestMessage?.senderUserId)?.[0]
//     const currentUnreadCountSecondUser = chatsCurrently?.unreadCount?.[secondUserId]

//     const isSecondUserInRoom = await isUserInRoom(
//         message?.chatId,
//         message?.chatRoomId,
//         secondUserId,
//         client
//     )

//     const newUnreadCount = () => {
//         return {
//             [`${message?.latestMessage.senderUserId}`]: 0,
//             [`${secondUserId}`]: isSecondUserInRoom === true ? 0 : currentUnreadCountSecondUser + 1
//         }
//     }
//     await chatsDB.updateOne(
//         {
//             chatRoomId: message?.chatRoomId,
//             chatId: message?.chatId
//         },
//         {
//             unreadCount: newUnreadCount(),
//             latestMessage: message?.latestMessage,
//             latestMessageTimestamp: message?.latestMessage?.latestMessageTimestamp
//         },
//         { new: true }
//     )

//     // send back to the client for new message information
//     io.emit('newMessage', {
//         ...message,
//         unreadCount: newUnreadCount()
//     });
// }

const handlePushNotifResponseCancelOrder = async (
  orderDataFromJob, // Lebih spesifik namanya, ini adalah data yang diteruskan oleh Agenda job
  io,
  socket,
  client, // ini sepertinya tidak digunakan di sini, tapi saya biarkan
  agenda
) => {
  const { orderId: orderMongoId, responseType, adminId } = orderDataFromJob; // Ambil data dari object yang diteruskan Agenda

  try {
    // 1. Mengambil data order lengkap dari orderId (_id Mongoose)
    let order = await Order.findOne({ orderId: orderMongoId }); // Menggunakan let karena akan diupdate

    if (!order) {
      console.warn(
        `[PushNotif] Order with ID ${orderMongoId} not found. Cannot send notification.`
      );
      return; // Hentikan eksekusi jika order tidak ditemukan
    }

    // 2. Mengambil data user dari user ID di orderData
    const user = await usersDB.findById(order.user); // order.user adalah ID pengguna

    if (!user) {
      console.warn(
        `[PushNotif] User with ID ${order.user} for order ${orderMongoId} not found. Cannot send notification.`
      );
      return; // Hentikan eksekusi jika user tidak ditemukan
    }

    // --- Logic untuk Update Status Order dan Hapus agendaJobId ---
    let newStatus;
    let updateFields = {
      $unset: { agendaJobId: "" }, // Hapus field agendaJobId
    };

    if (responseType === "approved") {
      newStatus = "cancelled";
      // Jika disetujui, tidak perlu previousStatus
      updateFields.$set = { status: newStatus };
    } else if (responseType === "rejected") {
      // Jika ditolak, kembalikan ke previousStatus (asumsikan previousStatus ada di order object)
      // Anda perlu memastikan 'previousStatus' ada di skema Order Anda
      newStatus = order.previousStatus || "processing"; // Default ke 'processing' jika previousStatus tidak ada
      updateFields.$set = { status: newStatus };
    } else {
      // Jika responseType tidak dikenal, bisa default ke 'cancel-requested' atau biarkan statusnya
      console.warn(
        `[PushNotif] Unknown responseType: ${responseType}. Order status not changed.`
      );
      newStatus = order.status; // Biarkan status tidak berubah
    }

    // Melakukan update pada order
    // Gunakan findByIdAndUpdate untuk mendapatkan dokumen yang diperbarui
    const updatedOrder = await Order.findByIdAndUpdate(
      order._id,
      updateFields,
      { new: true } // Mengembalikan dokumen yang sudah diperbarui
    );

    // Pastikan update berhasil
    if (!updatedOrder) {
      console.error(`[PushNotif] Failed to update order ${order._id} status.`);
      return;
    }

    // --- Variabel updatedOrders untuk dikirim ke GenAI atau respons lainnya ---
    const updatedOrders = [updatedOrder.toObject()].map((order) => {
      const status = () => {
        if (order.status === "cancelled") {
          return "Dibatalkan";
        } else if (order.status === "processing") {
          return "Diproses";
        } else if (order.status === "shipped") {
          return "Dikirim";
        }
      };
      return {
        ...order,
        status: status(),
      };
    }); // Mengubah Mongoose document menjadi plain JS object
    // Jika Anda punya lebih dari satu order yang diupdate dalam satu job,
    // Anda bisa membuat array ini berisi semua order yang diupdate.
    // Dalam kasus ini, karena hanya 1 order, kita buat array dengan 1 elemen.

    // --- Logic untuk membuat dan mengirim notifikasi & interaksi GenAI ---
    let notificationTitle = "";
    let notificationBody = "";
    let notificationIcon = "";
    let responseInstructionParts = []; // Menggunakan array untuk parts GenAI

    if (responseType === "approved") {
      notificationTitle = "Pembatalan Pesanan Disetujui! ✅";
      notificationBody = `Pesanan #${updatedOrder.orderId} Anda telah berhasil dibatalkan. Dana akan dikembalikan sesuai kebijakan.`;
      notificationIcon = "order_cancel_approved_icon_url";

      responseInstructionParts.push({
        text: `Berikan informasi singkat pesanan tersebut telah berhasil dibatalkan sesuai dengan data yang diberikan seperti notifikasi. Fokus pada detail dari order yang dibatalkan.
        
        Sajikan informasi dalam element HTML dengan style inline CSS:
        - Tanpa warna background dan tanpa border untuk div utama.
        - Maksimal font-size: 14px.
        - Untuk daftar, gunakan <ul style="list-style-type: disc; margin-left: 20px; padding: 0;">.
        - Untuk daftar bersarang (anak), gunakan <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">.
        `,
      });
      // GenAI akan menerima data updatedOrder, jadi dia bisa membaca status 'cancelled'
      // dan mengaplikasikan styling yang diminta.
    } else if (responseType === "rejected") {
      notificationTitle = "Pembatalan Pesanan Ditolak ❌";
      notificationBody = `Pesanan #${updatedOrder.orderId} Anda tidak dapat dibatalkan saat ini. Silakan cek detail pesanan atau hubungi CS.`;
      notificationIcon = "order_cancel_rejected_icon_url";

      responseInstructionParts.push({
        text: `Berikan informasi singkat bahwa permintaan pembatalan pesanan telah ditolak.
        Sajikan informasi dalam format HTML dengan style inline CSS:
        - Tanpa warna background dan tanpa border untuk div utama.
        - Maksimal font-size: 14px.
        `,
      });
    } else {
      notificationTitle = "Update Pembatalan Pesanan";
      notificationBody = `Status permintaan pembatalan pesanan #${updatedOrder.orderId} Anda telah diperbarui.`;
      notificationIcon = "default_notification_icon_url";

      responseInstructionParts.push({
        text: `Berikan informasi singkat bahwa status permintaan pembatalan pesanan telah diperbarui.
        Sajikan informasi dalam format HTML dengan style inline CSS:
        - Tanpa warna background dan tanpa border untuk div utama.
        - Maksimal font-size: 14px.
        `,
      });
    }

    // --- Memanggil GenAI dengan data order yang telah diperbarui ---
    // Penting: contents harus array of Part. Jika Anda mengirim JSON string, itu salah.
    // Gunakan functionResponse jika ini adalah respons dari tool yang dipanggil oleh model.
    // Jika ini adalah input dari sistem untuk model agar menghasilkan teks, gunakan text.

    // Asumsi: Anda ingin model AI untuk GENERATE TEKS RESPON berdasarkan updatedOrder
    const content = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user", // AI sebagai asisten, user memberikan informasi
          parts: [
            ...responseInstructionParts,
            {
              text: `Data pesanan yang telah diperbarui: ${JSON.stringify(
                updatedOrders
              )}`,
            },
          ],
        },
      ],
      // systemInstruction seharusnya juga berupa array of Parts.
      // Jika Anda hanya punya satu instruksi, bisa langsung di `contents` dengan role 'user'
      // atau di 'systemInstruction' dengan format yang benar.
      // Untuk menjaga simplicity, saya pindahkan instruksi ke contents dengan role 'user'.
      // config: {
      //   systemInstruction: [responseInstruction], // responseInstruction harus dalam format { text: "..." }
      // },
    });

    const objectAgendaId = new mongoose.Types.ObjectId(order.agendaJobId);
    await agenda.cancel({ _id: objectAgendaId });

    const aiResponse = content.text; // Ambil teks respons dari AI
    console.log(
      "AI Generated Response 'Notif Response Cancel Order':",
      aiResponse
    );

    // implement send messages
    const session = await mongoose.startSession();
    session.startTransaction();

    const userIds = [adminId, user.id];
    const chatsCurrently = await chatsDB.findOne({
      userIds: { $size: 2, $all: userIds },
    });

    let currentChat = null;
    if (!chatsCurrently) {
      async function createChatroomAndChats() {
        try {
          const chatRoomId = generateRandomId();
          const chatId = generateRandomId();
          const creationDate = Date.now();

          // if chat is empty
          const newChats = new chatsDB({
            chatId,
            chatRoomId,
            unreadCount: {
              [`${userIds[0]}`]: 0,
              [`${userIds[1]}`]: 0,
            },
            latestMessageTimestamp: 0,
            chatCreationDate: creationDate,
            userIds: userIds,
          });

          await newChats.save({ session });

          await session.commitTransaction();
          session.endSession();

          return {
            message: "Chat room data",
            ...newChats?._doc,
          };
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          return error;
        }
      }

      const result = await createChatroomAndChats();
      if (!result?.chatId) {
        next(result);
        return;
      }
      currentChat = result;
    } else {
      currentChat = chatsCurrently;
      await session.abortTransaction();
      session.endSession();
    }

    const chatRoomId = currentChat?.chatRoomId;
    const chatId = currentChat?.chatId;

    const senderUserId = adminId;
    const recipientProfileId = user.id;

    const latestMessageTimestamp = Date.now();
    const messageId = generateRandomId(15);

    await templateSendMessage({
      chatRoomId,
      chatId,
      senderUserId,
      recipientProfileId,
      latestMessageTimestamp,
      messageId,
      status: "UNREAD",
      messageType: "text",
      textMessage: aiResponse,
      orderData: {
        type: "confirmCancelOrderData",
        orders: updatedOrders,
      },
      role: "model",
      client,
      io,
      recipientProfileId,
    });

    // Data notifikasi yang akan dikirim ke klien melalui Socket.IO
    // const notificationPayload = {
    //   title: notificationTitle,
    //   body: notificationBody,
    //   icon: notificationIcon,
    //   type: "ORDER_CANCEL_RESPONSE", // Tipe notifikasi untuk identifikasi di frontend
    //   orderId: updatedOrder.orderId,
    //   status: updatedOrder.status, // Status order yang SUDAH diperbarui
    //   timestamp: new Date().toISOString(),
    //   aiMessage: aiResponse, // Tambahkan respons AI ke payload notifikasi
    // };
  } catch (error) {
    console.error(
      `[PushNotif] Error handling push notification for order ${orderMongoId}:`,
      error
    );
    // Anda mungkin ingin mencatat error ini lebih detail atau mencoba mekanisme retry
  }
};

const handleSendMessageFromAI = async (
  generatedText,
  message,
  latestMessageTimestamp,
  {
    io,
    socket,
    client,
    agenda,
    newMessageId,
    productData,
    orderData,
    toolArguments,
  },
  functionCallForHistory,
  functionResponseForHistory
) => {
  const { latestMessage, isNeedHeaderDate, recipientProfileId, role } = message;

  const chatRoomId = message?.chatRoomId;
  const chatId = message?.chatId;

  const senderUserId = recipientProfileId;
  const newRecipientProfileId = latestMessage?.senderUserId;

  let newMessageForUser = {
    chatId,
    chatRoomId,
    eventType: "send-message",
    latestMessage: {
      latestMessageTimestamp,
      messageId: newMessageId,
      messageType: "text",
      senderUserId,
      status: "UNREAD",
      textMessage:
        generatedText?.length > 0
          ? generatedText
          : "Maaf kami tidak tersedia untuk saat ini. Mohon coba lagi nanti.",
    },
    recipientProfileId: newRecipientProfileId,
    role: "model",
  };

  const isAvailableMessage = await chatRoomDB.findOne({
    chatId,
    chatRoomId,
    messageId: newMessageId,
  });

  if (!isAvailableMessage?._id) {
    await sendMessage(
      newMessageForUser,
      io,
      socket,
      client,
      agenda,
      {
        productData,
        orderData,
        toolArguments,
      },
      functionCallForHistory,
      functionResponseForHistory
    );
  } else {
    isAvailableMessage.textMessage =
      generatedText?.length > 0
        ? generatedText
        : "Maaf kami tidak tersedia untuk saat ini. Mohon coba lagi nanti.";
    if (productData?.length > 0) {
      isAvailableMessage.productData = productData;
    }
    if (toolArguments?.length > 0) {
      isAvailableMessage.toolArguments = toolArguments;
    }
    if (orderData?.length > 0) {
      isAvailableMessage.orderData = orderData;
    }
    if (
      functionCallForHistory?.length > 0 &&
      functionResponseForHistory?.length > 0
    ) {
      isAvailableMessage.functionCall = functionCallForHistory;
      isAvailableMessage.functionResponse = functionResponseForHistory;
    }
    await isAvailableMessage.save();
    // await chatRoomDB.findOneAndUpdate(
    //   {
    //     chatId,
    //     chatRoomId,
    //     messageId: newMessageId,
    //   },
    //   { textMessage: generatedText }
    // );

    // Update chats
    const chatsCurrently = await chatsDB.findOne({ chatRoomId, chatId });

    // Update latestMessage sebagai array
    let updatedLatestMessages = Array.isArray(chatsCurrently.latestMessage)
      ? [...chatsCurrently.latestMessage]
      : [];

    const existingIndexUserId1 = updatedLatestMessages.findIndex(
      (item) =>
        item.userId === chatsCurrently.userIds[0] &&
        item?.messageId === newMessageId
    );
    const existingIndexUserId2 = updatedLatestMessages.findIndex(
      (item) =>
        item.userId === chatsCurrently.userIds[1] &&
        item?.messageId === newMessageId
    );

    if (existingIndexUserId1 !== -1) {
      updatedLatestMessages[existingIndexUserId1].textMessage = generatedText;
      updatedLatestMessages[existingIndexUserId1].productData = productData;
      updatedLatestMessages[existingIndexUserId1].orderData = orderData;
    }
    if (existingIndexUserId2 !== -1) {
      updatedLatestMessages[existingIndexUserId2].textMessage = generatedText;
      updatedLatestMessages[existingIndexUserId2].productData = productData;
      updatedLatestMessages[existingIndexUserId2].orderData = orderData;
    }

    updatedLatestMessages = updatedLatestMessages.filter(
      (item) => item?.userId
    );

    await chatsDB.updateOne(
      { chatRoomId, chatId },
      {
        latestMessage: updatedLatestMessages,
        loadingBubbleMessages: false,
      }
    );

    const senderUserProfile = await usersDB.findOne({
      id: newRecipientProfileId,
    });

    io.emit("updateMessage", {
      ...newMessageForUser,
      username: senderUserProfile?.username,
      image: senderUserProfile?.image,
      imgCropped: senderUserProfile?.imgCropped,
      thumbnail: senderUserProfile?.thumbnail,
      latestMessage: updatedLatestMessages,
      messageUpdated: {
        ...newMessageForUser.latestMessage,
        productData,
        orderData,
      },
    });
  }
  return;
};

const handleGetNewMessageForBot = async (
  message,
  io,
  socket,
  client,
  agenda
) => {
  const { latestMessage, isNeedHeaderDate, recipientProfileId, role } = message;

  if (role === "model" || latestMessage?.messageType !== "text") {
    return;
  }

  const chatRoomId = message?.chatRoomId;
  const chatId = message?.chatId;

  const senderUserId = recipientProfileId;
  const newRecipientProfileId = latestMessage?.senderUserId;

  io.emit("typing-start", {
    recipientId: newRecipientProfileId,
    senderId: senderUserId,
  });
  // const textMessageFromAI = await processNewMessageWithAI([], message);
  // let newMessageForUser = {
  //   chatId,
  //   chatRoomId,
  //   eventType: "send-message",
  //   latestMessage: {
  //     latestMessageTimestamp: Date.now(),
  //     messageId: generateRandomId(15),
  //     messageType: "text",
  //     senderUserId,
  //     status: "UNREAD",
  //     textMessage:
  //       textMessageFromAI ?? "Maaf kami tidak tersedia untuk saat ini.",
  //   },
  //   recipientProfileId: newRecipientProfileId,
  //   role: "admin",
  // };

  // sendMessage(newMessageForUser, io, socket, client, agenda, false);

  // const history = await getConversationHistoryForGemini(message);

  await processNewMessageWithAI(
    [],
    message,
    async (
      responseText,
      message,
      latestMessageTimestamp,
      {
        io,
        socket,
        client,
        agenda,
        newMessageId,
        productData,
        orderData,
        toolArguments,
      },
      functionCallForHistory,
      functionResponseForHistory
    ) => {
      const result = await handleSendMessageFromAI(
        responseText,
        message,
        latestMessageTimestamp,
        {
          io,
          socket,
          client,
          agenda,
          newMessageId,
          productData,
          orderData,
          toolArguments,
        },
        functionCallForHistory,
        functionResponseForHistory
      );
      return result;
    },
    { io, socket, client, agenda }
  );
  io.emit("typing-stop", {
    recipientId: newRecipientProfileId,
    senderId: senderUserId,
  });
};

const cancelBotMessageJob = async (
  chatId,
  chatRoomId,
  userId,
  existingJobId,
  agenda,
  client
) => {
  if (existingJobId) {
    // 2. Jika ada job lama, batalkan job tersebut di Agenda
    console.log(
      `Membatalkan job balasan bot yang sudah ada (${existingJobId}) untuk chatRoom: ${chatRoomId}`
    );
    try {
      // agenda.cancel() akan menghapus job dari MongoDB
      const objectIdToCancel = new mongoose.Types.ObjectId(existingJobId);
      await agenda.cancel({ _id: objectIdToCancel });
    } catch (cancelError) {
      // Ini bisa terjadi jika job sudah selesai dieksekusi atau dibatalkan oleh proses lain
      console.warn(
        `Gagal membatalkan job Agenda ${existingJobId}:`,
        cancelError.message
      );
    }

    // Hapus juga entri dari Redis
    await client.del(
      `bot-message:chats:${chatId}:room:${chatRoomId}:userId:${userId}`
    );
  }
};

const createScheduleAIMessage = async (message, io, socket, agenda, client) => {
  const { latestMessage, isNeedHeaderDate, recipientProfileId, role } = message;

  const chatRoomId = message?.chatRoomId;
  const chatId = message?.chatId;

  const senderUserId = recipientProfileId;
  // const newRecipientProfileId = latestMessage?.senderUserId;

  let userIdForBot = null;

  if (role === "admin") {
    userIdForBot = latestMessage?.senderUserId;
  } else {
    userIdForBot = senderUserId;
  }

  const existingJobId = await existingBotReplyMessageJob(
    chatId,
    chatRoomId,
    userIdForBot,
    client
  );

  await cancelBotMessageJob(
    chatId,
    chatRoomId,
    userIdForBot,
    existingJobId,
    agenda,
    client
  );

  if (role === "admin" || !latestMessage?.textMessage) {
    return;
  }

  const schedule = await agenda.schedule(
    "in 1 seconds",
    agenda_name_sendMessageToCustomer,
    message
  );
  await client.set(
    `bot-message:chats:${chatId}:room:${chatRoomId}:userId:${senderUserId}`,
    schedule.attrs._id.toString()
  );
};

const sendMessage = async (
  message,
  io,
  socket,
  client,
  agenda,
  productData,
  functionCallForHistory,
  functionResponseForHistory
) => {
  const { latestMessage, isNeedHeaderDate, recipientProfileId } = message;

  const chatRoomId = message?.chatRoomId;
  const chatId = message?.chatId;

  // Cari header yang ada hari ini
  const headerMessageToday = await getTodayHeader(chatId, chatRoomId);

  let timeId;
  let headerMessage;
  let headerId;

  if (!headerMessageToday) {
    // ❌ Belum ada header → buat header baru
    timeId = generateRandomId(15);
    headerId = generateRandomId(15);

    headerMessage = new chatRoomDB({
      chatId,
      chatRoomId,
      messageId: headerId,
      isHeader: true,
      senderUserId: latestMessage?.senderUserId,
      latestMessageTimestamp: latestMessage?.latestMessageTimestamp,
      timeId,
    });
    await headerMessage.save();
  } else {
    timeId = headerMessageToday.timeId;
    headerId = headerMessageToday.messageId;
  }

  // Tambahkan pesan utama (dengan timeId yang sama)
  const chatRoomData = {
    chatId,
    chatRoomId,
    messageId: latestMessage?.messageId,
    senderUserId: latestMessage?.senderUserId,
    messageType: latestMessage?.messageType,
    textMessage: latestMessage?.textMessage,
    latestMessageTimestamp: latestMessage?.latestMessageTimestamp,
    status: latestMessage?.status,
    timeId,
  };
  if (latestMessage?.replyView) {
    chatRoomData.replyView = latestMessage.replyView;
  }
  if (latestMessage?.document) {
    chatRoomData.document = latestMessage.document;

    // if (latestMessage.messageType === "image") {
    //   const thumbnail = await generateBase64ThumbnailFromUrl(
    //     latestMessage.document.url
    //   );
    //   if (thumbnail) {
    //     chatRoomData.document.thumbnail = thumbnail;
    //   }
    // }
  }
  if (productData?.productData?.length > 0) {
    chatRoomData.productData = productData.productData;
  }
  if (productData?.orderData?.orders?.length > 0) {
    chatRoomData.orderData = productData.orderData;
  }
  if (productData?.toolArguments?.length > 0) {
    chatRoomData.toolArguments = productData.toolArguments;
  }
  if (
    functionCallForHistory?.length > 0 &&
    functionResponseForHistory?.length > 0 &&
    message?.role === "model"
  ) {
    chatRoomData.functionCall = functionCallForHistory;
    chatRoomData.functionResponse = functionResponseForHistory;
  }
  if (message?.role === "model") {
    chatRoomData.role = "model";
  }

  const newChatRoom = new chatRoomDB(chatRoomData);
  await newChatRoom.save();

  // Update unread count
  const chatsCurrently = await chatsDB.findOne({ chatRoomId, chatId });
  const secondUserId = Object.keys(chatsCurrently?.unreadCount || {}).find(
    (id) => id !== latestMessage?.senderUserId
  );
  const currentUnreadCount = chatsCurrently?.unreadCount?.[secondUserId] || 0;

  const isSecondUserInRoom = await isUserInRoom(
    chatId,
    chatRoomId,
    secondUserId,
    client
  );

  const newUnreadCount = {
    [latestMessage.senderUserId]: 0,
    [secondUserId]: isSecondUserInRoom
      ? 0
      : latestMessage?.document
      ? currentUnreadCount
      : currentUnreadCount + 1,
  };

  // Update latestMessage sebagai array
  let updatedLatestMessages = Array.isArray(chatsCurrently.latestMessage)
    ? [...chatsCurrently.latestMessage]
    : [];

  const latestMessageWithUserId1 = {
    ...latestMessage,
    productData: productData?.productData ?? null,
    orderData: productData?.orderData ?? null,
    userId: chatsCurrently.userIds[0],
    timeId,
  };
  const latestMessageWithUserId2 = {
    ...latestMessage,
    productData: productData?.productData ?? null,
    orderData: productData?.orderData ?? null,
    userId: chatsCurrently.userIds[1],
    timeId,
  };

  const existingIndexUserId1 = updatedLatestMessages.findIndex(
    (item) => item.userId === latestMessageWithUserId1.userId
  );
  const existingIndexUserId2 = updatedLatestMessages.findIndex(
    (item) => item.userId === latestMessageWithUserId2.userId
  );

  if (existingIndexUserId1 !== -1) {
    updatedLatestMessages[existingIndexUserId1] = latestMessageWithUserId1;
  } else {
    updatedLatestMessages.push(latestMessageWithUserId1);
  }
  if (existingIndexUserId2 !== -1) {
    updatedLatestMessages[existingIndexUserId2] = latestMessageWithUserId2;
  } else {
    updatedLatestMessages.push(latestMessageWithUserId2);
  }

  updatedLatestMessages = updatedLatestMessages.filter((item) => item?.userId);

  let updateChatParams = {
    unreadCount: newUnreadCount,
    latestMessage: updatedLatestMessages,
  };

  if (message?.role === "model") {
    updateChatParams.loadingBubbleMessages = false;
  }

  await chatsDB.updateOne({ chatRoomId, chatId }, updateChatParams, {
    new: true,
  });

  const senderUserId = updatedLatestMessages.find(
    (msg) => msg.userId !== recipientProfileId
  );
  const senderUserProfile = await usersDB.findOne({ id: senderUserId?.userId });

  // if (usingBot) {
  //   // handleGetNewMessageForBot(message, io, socket, client, agenda);
  //   await createScheduleAIMessage(message, io, socket, agenda, client);
  // }
  await createScheduleAIMessage(message, io, socket, agenda, client);

  // Emit header dulu
  if (headerMessage?.messageId) {
    io.emit("newMessage", {
      chatId,
      chatRoomId,
      eventType: message.eventType,
      isNeedHeaderDate,
      recipientProfileId,
      timeId,
      messageId: headerMessage.messageId,
      isHeader: true,
      latestMessageTimestamp: headerMessage.latestMessageTimestamp,
      isFromMedia: latestMessage?.document?.type ? true : null,
      senderUserId: latestMessage?.senderUserId,
    });
  }

  io.emit("newMessage", {
    ...message,
    username: senderUserProfile?.username,
    image: senderUserProfile?.image,
    imgCropped: senderUserProfile?.imgCropped,
    thumbnail: senderUserProfile?.thumbnail,
    latestMessage: updatedLatestMessages,
    unreadCount: newUnreadCount,
    timeId,
    headerId,
  });
};

// const sendMessage = async (message, io, socket, client) => {
//     await chatRoomDB.updateOne(
//         {
//             chatRoomId: message?.chatRoomId,
//             chatId: message?.chatId
//         },
//         { $push: { data: { $each: [message?.latestMessage], $position: 0 } } },
//         { new: true }
//     )
//     const chatsCurrently = await chatsDB.findOne({
//         chatRoomId: message?.chatRoomId,
//         chatId: message?.chatId
//     })

//     const secondUserId = Object?.keys(chatsCurrently?.unreadCount)?.filter(id => id !== message?.latestMessage?.senderUserId)?.[0]
//     const currentUnreadCountSecondUser = chatsCurrently?.unreadCount?.[secondUserId]

//     const isSecondUserInRoom = await isUserInRoom(
//         message?.chatId,
//         message?.chatRoomId,
//         secondUserId,
//         client
//     )

//     const newUnreadCount = () => {
//         return {
//             [`${message?.latestMessage.senderUserId}`]: 0,
//             [`${secondUserId}`]: isSecondUserInRoom === true ? 0 : currentUnreadCountSecondUser + 1
//         }
//     }
//     await chatsDB.updateOne(
//         {
//             chatRoomId: message?.chatRoomId,
//             chatId: message?.chatId
//         },
//         {
//             unreadCount: newUnreadCount(),
//             latestMessage: message?.latestMessage,
//             latestMessageTimestamp: message?.latestMessage?.latestMessageTimestamp
//         },
//         { new: true }
//     )

//     // send back to the client for new message information
//     io.emit('newMessage', {
//         ...message,
//         unreadCount: newUnreadCount()
//     });
// }

const handleReactionMessage = async (message, io, socket, client) => {
  const { chatRoomId, chatId, messageId, reaction } = message;
  const { emoji, senderUserId, code, latestMessageTimestamp } = reaction;

  try {
    if (!chatRoomId || !senderUserId || !emoji) {
      console.error("Invalid reaction payload:", {
        chatRoomId,
        senderUserId,
        emoji,
      });
      return;
    }

    const filterQuery = {
      chatRoomId,
      chatId,
      messageId,
    };

    const chatRoomDoc = await chatRoomDB.findOne(filterQuery);
    if (!chatRoomDoc) {
      console.error("Chat room not found with chatRoomId:", chatRoomId);
      return;
    }

    // Cek apakah reaction sudah ada
    const existingReaction = chatRoomDoc.reactions.find(
      (r) => r.senderUserId === senderUserId
    );

    let isDeleted = false;

    if (existingReaction) {
      if (existingReaction.emoji === emoji) {
        // Sama → hapus
        await chatRoomDB.updateOne(filterQuery, {
          $pull: { reactions: { senderUserId } },
        });
        isDeleted = true;
        console.log("Removed existing reaction");
      } else {
        // Beda → hapus dulu, lalu tambah (PISAH)
        await chatRoomDB.updateOne(filterQuery, {
          $pull: { reactions: { senderUserId } },
        });
        await chatRoomDB.updateOne(filterQuery, {
          $push: {
            reactions: { emoji, senderUserId, code, latestMessageTimestamp },
          },
        });
        console.log("Replaced reaction with new emoji");
      }
    } else {
      // Belum ada → tambahkan
      await chatRoomDB.updateOne(filterQuery, {
        $push: {
          reactions: { emoji, senderUserId, code, latestMessageTimestamp },
        },
      });
      console.log("Added new reaction");
    }

    // Ambil ulang doc untuk emit data terbaru
    const updatedDoc = await chatRoomDB.findOne(filterQuery);

    io.emit("newMessage", {
      ...message,
      eventType: "reaction-message",
      isDeleted,
      reactions: updatedDoc.reactions,
    });
  } catch (error) {
    console.error("Error handling reaction message:", error);
  }
};

const handleUpdateLatestMessageOnDeletedMessage = async (
  message,
  latestMessageMainUserId,
  latestMessageSecondUserId
) => {
  try {
    const {
      chatRoomId,
      chatId,
      messageId,
      senderUserId,
      secondProfileId,
      eventType,
      deletionType: requestedDeletionType,
    } = message;

    const chatsCurrently = await chatsDB.findOne({ chatRoomId, chatId });

    if (!chatsCurrently?.latestMessage) {
      return [];
    }

    const latestMessageUserCurrently = chatsCurrently.latestMessage.find(
      (msg) => msg?.userId === senderUserId
    );
    if (requestedDeletionType === "me" && !latestMessageUserCurrently) {
      return chatsCurrently?.latestMessage ?? [];
    }
    if (
      requestedDeletionType === "me" ||
      requestedDeletionType === "permanent"
    ) {
      // const latestMessage = await chatRoomDB
      //   .findOne({
      //     chatId,
      //     chatRoomId,
      //     isHeader: { $ne: true },
      //     $nor: [
      //       {
      //         isDeleted: {
      //           $elemMatch: {
      //             senderUserId: senderUserId,
      //             deletionType: { $in: ["me", "permanent"] },
      //           },
      //         },
      //       },
      //     ],
      //   })
      //   .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
      //   .lean(); // optional: untuk dapat plain JS object

      const latestMessage = await findLatestMessageForUser(
        chatId,
        chatRoomId,
        senderUserId
      );
      if (!latestMessage?.chatRoomId) {
        let newLatestMessages = chatsCurrently?.latestMessage;
        newLatestMessages = newLatestMessages.filter(
          (msg) => msg?.userId !== senderUserId
        );

        const result = await chatsDB.findOneAndUpdate(
          { chatRoomId, chatId },
          {
            latestMessage: newLatestMessages,
          },
          { new: true }
        );
        return result?.latestMessage;
      }

      const newLatestMessage = {
        messageId: latestMessage.messageId,
        senderUserId: latestMessage.senderUserId,
        messageType: latestMessage.messageType,
        textMessage: latestMessage.textMessage,
        latestMessageTimestamp: latestMessage.latestMessageTimestamp,
        status: latestMessage.status,
        userId: senderUserId,
        timeId: latestMessage.timeId,
        isDeleted: latestMessage?.isDeleted ?? [],
      };
      if (latestMessage?.document) {
        newLatestMessage.document = latestMessage.document;
      }
      if (latestMessage?.completionTimestamp) {
        newLatestMessage.completionTimestamp =
          latestMessage.completionTimestamp;
      }
      if (latestMessage?.completionTimeId) {
        newLatestMessage.completionTimeId = latestMessage.completionTimeId;
      }

      const latestMessageIndex = chatsCurrently.latestMessage.findIndex(
        (msg) => msg.userId === senderUserId
      );
      const updatedLatestMessages = chatsCurrently.latestMessage;
      updatedLatestMessages[latestMessageIndex] = newLatestMessage;

      const result = await chatsDB.findOneAndUpdate(
        { chatRoomId, chatId },
        {
          latestMessage: updatedLatestMessages,
        },
        { new: true }
      );

      return result?.latestMessage;
    } else if (requestedDeletionType === "everyone") {
      const latestMessages = chatsCurrently.latestMessage;
      const indexLatestMessageMainUserId = latestMessages?.findIndex(
        (msg) => msg?.userId === senderUserId
      );
      const indexLatestMessageSecondUserId = latestMessages?.findIndex(
        (msg) => msg?.userId === secondProfileId
      );

      let isMustUpdatedLatestMessages = false;

      if (latestMessageMainUserId?.messageId === messageId) {
        // const newLatestMessageMainUserId = await chatRoomDB
        //   .findOne({
        //     chatId,
        //     chatRoomId,
        //     isHeader: { $ne: true },
        //     $nor: [
        //       {
        //         isDeleted: {
        //           $elemMatch: {
        //             senderUserId: senderUserId,
        //             deletionType: { $in: ["me", "permanent"] },
        //           },
        //         },
        //       },
        //     ],
        //   })
        //   .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
        //   .lean();
        const newLatestMessageMainUserId = await findLatestMessageForUser(
          chatId,
          chatRoomId,
          senderUserId // profileId untuk filter di helper
        );

        if (
          newLatestMessageMainUserId?.chatRoomId &&
          indexLatestMessageMainUserId !== -1
        ) {
          const newLatestMessage = {
            messageId: newLatestMessageMainUserId.messageId,
            senderUserId: newLatestMessageMainUserId.senderUserId,
            messageType: newLatestMessageMainUserId.messageType,
            textMessage: newLatestMessageMainUserId.textMessage,
            latestMessageTimestamp:
              newLatestMessageMainUserId.latestMessageTimestamp,
            status: newLatestMessageMainUserId.status,
            userId: senderUserId,
            timeId: newLatestMessageMainUserId.timeId,
            isDeleted: newLatestMessageMainUserId?.isDeleted ?? [],
          };
          if (newLatestMessageMainUserId?.document) {
            newLatestMessage.document = newLatestMessageMainUserId.document;
          }
          if (newLatestMessageMainUserId?.completionTimestamp) {
            newLatestMessage.completionTimestamp =
              newLatestMessageMainUserId.completionTimestamp;
          }
          if (newLatestMessageMainUserId?.completionTimeId) {
            newLatestMessage.completionTimeId =
              newLatestMessageMainUserId.completionTimeId;
          }
          latestMessages[indexLatestMessageMainUserId] = newLatestMessage;
          isMustUpdatedLatestMessages = true;
        } else if (
          newLatestMessageMainUserId?.chatRoomId &&
          indexLatestMessageMainUserId === -1
        ) {
          const newLatestMessage = {
            messageId: newLatestMessageMainUserId.messageId,
            senderUserId: newLatestMessageMainUserId.senderUserId,
            messageType: newLatestMessageMainUserId.messageType,
            textMessage: newLatestMessageMainUserId.textMessage,
            latestMessageTimestamp:
              newLatestMessageMainUserId.latestMessageTimestamp,
            status: newLatestMessageMainUserId.status,
            userId: senderUserId,
            timeId: newLatestMessageMainUserId.timeId,
            isDeleted: newLatestMessageMainUserId?.isDeleted ?? [],
          };
          if (newLatestMessageMainUserId?.document) {
            newLatestMessage.document = newLatestMessageMainUserId.document;
          }
          if (newLatestMessageMainUserId?.completionTimestamp) {
            newLatestMessage.completionTimestamp =
              newLatestMessageMainUserId.completionTimestamp;
          }
          if (newLatestMessageMainUserId?.completionTimeId) {
            newLatestMessage.completionTimeId =
              newLatestMessageMainUserId.completionTimeId;
          }
          latestMessages.push(newLatestMessage);
          isMustUpdatedLatestMessages = true;
        }
      }

      if (latestMessageSecondUserId?.messageId === messageId) {
        // const newLatestMessageSecondUserId = await chatRoomDB
        //   .findOne({
        //     chatId,
        //     chatRoomId,
        //     isHeader: { $ne: true },
        //     $nor: [
        //       {
        //         isDeleted: {
        //           $elemMatch: {
        //             senderUserId: secondProfileId,
        //             deletionType: { $in: ["me", "permanent"] },
        //           },
        //         },
        //       },
        //     ],
        //   })
        //   .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
        //   .lean();
        const newLatestMessageSecondUserId = await findLatestMessageForUser(
          chatId,
          chatRoomId,
          secondProfileId // profileId untuk filter di helper
        );

        if (
          newLatestMessageSecondUserId?.chatRoomId &&
          indexLatestMessageSecondUserId !== -1
        ) {
          const newLatestMessage = {
            messageId: newLatestMessageSecondUserId.messageId,
            senderUserId: newLatestMessageSecondUserId.senderUserId,
            messageType: newLatestMessageSecondUserId.messageType,
            textMessage: newLatestMessageSecondUserId.textMessage,
            latestMessageTimestamp:
              newLatestMessageSecondUserId.latestMessageTimestamp,
            status: newLatestMessageSecondUserId.status,
            userId: secondProfileId,
            timeId: newLatestMessageSecondUserId.timeId,
            isDeleted: newLatestMessageSecondUserId?.isDeleted ?? [],
          };
          if (newLatestMessageSecondUserId?.document) {
            newLatestMessage.document = newLatestMessageSecondUserId.document;
          }
          if (newLatestMessageSecondUserId?.completionTimestamp) {
            newLatestMessage.completionTimestamp =
              newLatestMessageSecondUserId.completionTimestamp;
          }
          if (newLatestMessageSecondUserId?.completionTimeId) {
            newLatestMessage.completionTimeId =
              newLatestMessageSecondUserId.completionTimeId;
          }
          latestMessages[indexLatestMessageSecondUserId] = newLatestMessage;
          isMustUpdatedLatestMessages = true;
        } else if (
          newLatestMessageSecondUserId?.chatRoomId &&
          indexLatestMessageSecondUserId === -1
        ) {
          const newLatestMessage = {
            messageId: newLatestMessageSecondUserId.messageId,
            senderUserId: newLatestMessageSecondUserId.senderUserId,
            messageType: newLatestMessageSecondUserId.messageType,
            textMessage: newLatestMessageSecondUserId.textMessage,
            latestMessageTimestamp:
              newLatestMessageSecondUserId.latestMessageTimestamp,
            status: newLatestMessageSecondUserId.status,
            userId: secondProfileId,
            timeId: newLatestMessageSecondUserId.timeId,
            isDeleted: newLatestMessageSecondUserId?.isDeleted ?? [],
          };
          if (newLatestMessageSecondUserId?.document) {
            newLatestMessage.document = newLatestMessageSecondUserId.document;
          }
          if (newLatestMessageSecondUserId?.completionTimestamp) {
            newLatestMessage.completionTimestamp =
              newLatestMessageSecondUserId.completionTimestamp;
          }
          if (newLatestMessageSecondUserId?.completionTimeId) {
            newLatestMessage.completionTimeId =
              newLatestMessageSecondUserId.completionTimeId;
          }
          latestMessages.push(newLatestMessage);
          isMustUpdatedLatestMessages = true;
        }
      }

      if (isMustUpdatedLatestMessages) {
        const result = await chatsDB.findOneAndUpdate(
          { chatRoomId, chatId },
          {
            latestMessage: latestMessages,
          },
          { new: true }
        );
        return result?.latestMessage;
      }
    }
  } catch (error) {
    console.error("Error handling delete message:", error);
    return null;
  }
};

// const handleUpdateLatestMessageOnDeletedMessage = async (
//   message,
//   latestMessageMainUserId_fetched, // Ini sudah yang sudah di-fetch dengan sort logic baru
//   latestMessageSecondUserId_fetched // Ini juga sudah di-fetch dengan sort logic baru
// ) => {
//   try {
//     const {
//       chatRoomId,
//       chatId,
//       senderUserId, // User yang melakukan delete
//       secondProfileId, // User lain
//       deletionType: requestedDeletionType,
//     } = message;

//     const chatsCurrently = await chatsDB.findOne({ chatRoomId, chatId });

//     if (!chatsCurrently?.latestMessage) {
//       return [];
//     }

//     let updatedLatestMessages = [...chatsCurrently.latestMessage]; // Buat salinan untuk imutabilitas

//     let isUpdated = false;

//     // Logic untuk senderUserId
//     const indexMainUser = updatedLatestMessages.findIndex(
//       (msg) => msg?.userId === senderUserId
//     );

//     if (
//       requestedDeletionType === "me" ||
//       requestedDeletionType === "permanent"
//     ) {
//       if (latestMessageMainUserId_fetched) {
//         // Jika ada pesan terbaru yang valid
//         const newLatestMessageForMainUser = {
//           messageId: latestMessageMainUserId_fetched.messageId,
//           senderUserId: latestMessageMainUserId_fetched.senderUserId,
//           messageType: latestMessageMainUserId_fetched.messageType,
//           textMessage: latestMessageMainUserId_fetched.textMessage,
//           latestMessageTimestamp:
//             latestMessageMainUserId_fetched.latestMessageTimestamp,
//           status: latestMessageMainUserId_fetched.status,
//           userId: senderUserId, // Penting: userId di sini adalah user yang melihat latest message ini
//           timeId: latestMessageMainUserId_fetched.timeId,
//           isDeleted: latestMessageMainUserId_fetched?.isDeleted ?? [],
//           document: latestMessageMainUserId_fetched?.document, // Tambahkan document jika ada
//           completionTimestamp:
//             latestMessageMainUserId_fetched?.completionTimestamp, // Tambahkan completionTimestamp
//           completionTimeId: latestMessageMainUserId_fetched?.completionTimeId, // Tambahkan completionTimeId
//         };

//         if (indexMainUser !== -1) {
//           updatedLatestMessages[indexMainUser] = newLatestMessageForMainUser;
//         } else {
//           updatedLatestMessages.push(newLatestMessageForMainUser);
//         }
//         isUpdated = true;
//       } else {
//         // Tidak ada latest message yang valid untuk main user, hapus entry mereka
//         if (indexMainUser !== -1) {
//           updatedLatestMessages.splice(indexMainUser, 1);
//           isUpdated = true;
//         }
//       }
//     } else if (requestedDeletionType === "everyone") {
//       // Logic untuk senderUserId
//       if (latestMessageMainUserId_fetched) {
//         const newLatestMessageForMainUser = {
//           messageId: latestMessageMainUserId_fetched.messageId,
//           senderUserId: latestMessageMainUserId_fetched.senderUserId,
//           messageType: latestMessageMainUserId_fetched.messageType,
//           textMessage: latestMessageMainUserId_fetched.textMessage,
//           latestMessageTimestamp:
//             latestMessageMainUserId_fetched.latestMessageTimestamp,
//           status: latestMessageMainUserId_fetched.status,
//           userId: senderUserId, // Penting: userId di sini adalah user yang melihat latest message ini
//           timeId: latestMessageMainUserId_fetched.timeId,
//           isDeleted: latestMessageMainUserId_fetched?.isDeleted ?? [],
//           document: latestMessageMainUserId_fetched?.document,
//           completionTimestamp:
//             latestMessageMainUserId_fetched?.completionTimestamp,
//           completionTimeId: latestMessageMainUserId_fetched?.completionTimeId,
//         };

//         if (indexMainUser !== -1) {
//           updatedLatestMessages[indexMainUser] = newLatestMessageForMainUser;
//         } else {
//           updatedLatestMessages.push(newLatestMessageForMainUser);
//         }
//         isUpdated = true;
//       } else {
//         if (indexMainUser !== -1) {
//           // Jika sudah tidak ada latest message, hapus dari latestMessages
//           updatedLatestMessages.splice(indexMainUser, 1);
//           isUpdated = true;
//         }
//       }

//       // Logic untuk secondProfileId
//       const indexSecondUser = updatedLatestMessages.findIndex(
//         (msg) => msg?.userId === secondProfileId
//       );

//       if (latestMessageSecondUserId_fetched) {
//         const newLatestMessageForSecondUser = {
//           messageId: latestMessageSecondUserId_fetched.messageId,
//           senderUserId: latestMessageSecondUserId_fetched.senderUserId,
//           messageType: latestMessageSecondUserId_fetched.messageType,
//           textMessage: latestMessageSecondUserId_fetched.textMessage,
//           latestMessageTimestamp:
//             latestMessageSecondUserId_fetched.latestMessageTimestamp,
//           status: latestMessageSecondUserId_fetched.status,
//           userId: secondProfileId, // Penting: userId di sini adalah user yang melihat latest message ini
//           timeId: latestMessageSecondUserId_fetched.timeId,
//           isDeleted: latestMessageSecondUserId_fetched?.isDeleted ?? [],
//           document: latestMessageSecondUserId_fetched?.document,
//           completionTimestamp:
//             latestMessageSecondUserId_fetched?.completionTimestamp,
//           completionTimeId: latestMessageSecondUserId_fetched?.completionTimeId,
//         };

//         if (indexSecondUser !== -1) {
//           updatedLatestMessages[indexSecondUser] =
//             newLatestMessageForSecondUser;
//         } else {
//           updatedLatestMessages.push(newLatestMessageForSecondUser);
//         }
//         isUpdated = true;
//       } else {
//         if (indexSecondUser !== -1) {
//           // Jika sudah tidak ada latest message, hapus dari latestMessages
//           updatedLatestMessages.splice(indexSecondUser, 1);
//           isUpdated = true;
//         }
//       }
//     }

//     if (isUpdated) {
//       const result = await chatsDB.findOneAndUpdate(
//         { chatRoomId, chatId },
//         {
//           latestMessage: updatedLatestMessages,
//         },
//         { new: true }
//       );
//       return result?.latestMessage;
//     } else {
//       return chatsCurrently?.latestMessage ?? []; // Return original if no update happened
//     }
//   } catch (error) {
//     console.error(
//       "Error handling update latest message on deleted message:",
//       error
//     );
//     return null;
//   }
// };

const handleDeleteMessage = async (message, io, socket, client) => {
  try {
    const {
      chatRoomId,
      chatId,
      messageId,
      senderUserId,
      eventType,
      secondProfileId,
      deletionType: requestedDeletionType,
    } = message;

    const priority = { me: 1, everyone: 2, permanent: 3 };

    // 1. Cari pesan yang akan dihapus
    const targetMessage = await chatRoomDB.findOne({
      chatRoomId,
      chatId,
      messageId,
    });

    if (!targetMessage) {
      console.log(`Message not found: ${messageId}`);
      return;
    }

    const existingEntry = targetMessage.isDeleted.find(
      (entry) => entry.senderUserId === senderUserId
    );

    let isMustUpdatedLatestMessages = false;

    // const latestMessageMainUserId = await chatRoomDB
    //   .findOne({
    //     chatId,
    //     chatRoomId,
    //     isHeader: { $ne: true },
    //     $nor: [
    //       {
    //         isDeleted: {
    //           $elemMatch: {
    //             senderUserId: senderUserId,
    //             deletionType: { $in: ["me", "permanent"] },
    //           },
    //         },
    //       },
    //     ],
    //   })
    //   .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
    //   .lean();

    // --- REVISI PENTING: Gunakan findLatestMessageForUser helper ---
    // Mencari latestMessage untuk user yang melakukan penghapusan (senderUserId)
    const latestMessageMainUserId = await findLatestMessageForUser(
      chatId,
      chatRoomId,
      senderUserId // profileId untuk filter di helper
    );

    let latestMessageSecondUserId = null;

    if (requestedDeletionType === "everyone") {
      // latestMessageSecondUserId = await chatRoomDB
      //   .findOne({
      //     chatId,
      //     chatRoomId,
      //     isHeader: { $ne: true },
      //     $nor: [
      //       {
      //         isDeleted: {
      //           $elemMatch: {
      //             senderUserId: secondProfileId,
      //             deletionType: { $in: ["me", "permanent"] },
      //           },
      //         },
      //       },
      //     ],
      //   })
      //   .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
      //   .lean();

      // Mencari latestMessage untuk user lain (secondProfileId)
      latestMessageSecondUserId = await findLatestMessageForUser(
        chatId,
        chatRoomId,
        secondProfileId // profileId untuk filter di helper
      );
    }

    if (messageId === latestMessageMainUserId?.messageId) {
      isMustUpdatedLatestMessages = true;
    }

    // Helper untuk emit dengan isDeleted terbaru (tanpa property tambahan)
    const emitWithLatestIsDeleted = async (actionLog) => {
      const updatedMessage = await chatRoomDB.findOne({
        chatRoomId,
        chatId,
        messageId,
      });
      // handle updated to chats db
      let newLatestMessagesData = [];
      let isUpdatedLatestMessage = false;
      if (isMustUpdatedLatestMessages || latestMessageSecondUserId) {
        const updatedLatestMessages =
          await handleUpdateLatestMessageOnDeletedMessage(
            message,
            latestMessageMainUserId,
            latestMessageSecondUserId
          );
        if (updatedLatestMessages) {
          isUpdatedLatestMessage = true;
        }
        if (updatedLatestMessages?.length > 0) {
          newLatestMessagesData = updatedLatestMessages;
        }
      }
      let sendNewMessageData = {
        chatRoomId,
        chatId,
        messageId,
        isDeleted: updatedMessage.isDeleted.map((item) => ({
          senderUserId: item.senderUserId,
          deletionType: item.deletionType,
        })),
        eventType,
        isUpdatedLatestMessage,
      };
      if (newLatestMessagesData.length > 0) {
        sendNewMessageData.latestMessage = newLatestMessagesData;
      }
      io.emit("newMessage", sendNewMessageData);
      console.log(actionLog);
    };

    if (existingEntry) {
      const existingDeletionType = existingEntry.deletionType;

      if (existingDeletionType === requestedDeletionType) {
        await emitWithLatestIsDeleted(
          `Message ${messageId} deletion (already exists) by ${senderUserId}`
        );
        return;
      }

      // Special case me + everyone → permanent
      if (
        requestedDeletionType === "me" &&
        existingDeletionType === "everyone"
      ) {
        const upgradedDeletionType = "permanent";
        await chatRoomDB.updateOne(
          { chatRoomId, chatId, messageId },
          { $set: { "isDeleted.$[elem].deletionType": upgradedDeletionType } },
          { arrayFilters: [{ "elem.senderUserId": senderUserId }] }
        );
        await emitWithLatestIsDeleted(
          `Message ${messageId} deletion (me + everyone → upgraded to permanent) by ${senderUserId}`
        );
        return;
      }

      // Kalau existing > request → skip update
      if (priority[existingDeletionType] > priority[requestedDeletionType]) {
        await emitWithLatestIsDeleted(
          `Message ${messageId} deletion (skip update, higher existing) by ${senderUserId}`
        );
        return;
      }

      // Kalau request > existing → update pakai request
      await chatRoomDB.updateOne(
        { chatRoomId, chatId, messageId },
        { $set: { "isDeleted.$[elem].deletionType": requestedDeletionType } },
        { arrayFilters: [{ "elem.senderUserId": senderUserId }] }
      );
      await emitWithLatestIsDeleted(
        `Message ${messageId} deletion (updated ${existingDeletionType} → ${requestedDeletionType}) by ${senderUserId}`
      );

      // handle updated to chats db
      // if (isMustUpdatedLatestMessages || latestMessageSecondUserId) {
      //   handleUpdateLatestMessageOnDeletedMessage(
      //     message,
      //     io,
      //     latestMessageMainUserId,
      //     latestMessageSecondUserId
      //   );
      // }
      return;
    }

    // Kalau belum ada senderUserId → tambahkan baru
    await chatRoomDB.updateOne(
      { chatRoomId, chatId, messageId },
      {
        $addToSet: {
          isDeleted: { senderUserId, deletionType: requestedDeletionType },
        },
      }
    );
    await emitWithLatestIsDeleted(
      `Message ${messageId} deletion (new entry ${requestedDeletionType}) by ${senderUserId}`
    );
    // // handle updated to chats db
    // if (isMustUpdatedLatestMessages || latestMessageSecondUserId) {
    //   handleUpdateLatestMessageOnDeletedMessage(
    //     message,
    //     io,
    //     latestMessageMainUserId,
    //     latestMessageSecondUserId
    //   );
    // }
  } catch (error) {
    console.error("Error handling delete message:", error);
  }
};

const handleGetSendMessage = async (message, io, socket, client, agenda) => {
  if (message?.eventType === "send-message") {
    sendMessage(message, io, socket, client, agenda);
  } else if (message?.eventType === "reaction-message") {
    handleReactionMessage(message, io, socket, client);
  } else if (message?.eventType === "delete-message") {
    handleDeleteMessage(message, io, socket, client);
  }
};

const handlePushNotifPaymentResponse = async (
  { orderId, agenda_id },
  io,
  socket,
  client,
  agenda
) => {
  try {
    const order = await Order.findOne({ orderId });

    if (!order) {
      console.log(
        `Order not found with orderId "${orderId}" in push notif payment response cases`
      );
      return;
    }
    const user = await usersDB.findOne({ _id: order.user });
    if (!user) {
      console.log(
        `User not found with _id "${order.user}" in push notif payment response cases `
      );
      return;
    }

    const instruction = {
      text: `
      AI wajib memberikan instruksi ini seperti layaknya deskripsi notifikasi untuk Pelanggan,

      Berikan informasi singkat pesanan tersebut telah berhasil melakukan "Pembayaran" dan pesanan Anda sedang <span style="color: oklch(42.4% 0.199 265.638); font-size: 13px;">"Diproses"</span>.
        
        Gunakan informasi ini dengan style inline CSS:
        - Tanpa warna background dan tanpa border untuk div utama.
        - Maksimal font-size: 14px.
        - Jika status "cancelled", gunakan warna teks: oklch(57.7% 0.245 27.325).
        - Untuk daftar, gunakan <ul style="list-style-type: disc; margin-left: 20px; padding: 0;">.
        - Untuk daftar bersarang (anak), gunakan <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">.
        
        <br/><br/>
        Berikan keterangan di akhir percakapan seperti :
        Mohon menunggu kami akan memberitahukan Anda saat pesanan Anda kami kirim.
        `,
    };

    const content = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user", // AI sebagai asisten, user memberikan informasi
          parts: [
            {
              text: `Data pesanan yang telah "Diproses": ${JSON.stringify(
                order._doc
              )}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: [instruction],
      },
    });

    const objectAgendaId = new mongoose.Types.ObjectId(agenda_id);
    await agenda.cancel({ _id: objectAgendaId });

    const aiResponse = content.text; // Ambil teks respons dari AI
    console.log(
      "AI Generated Response 'Push notif payment response':",
      aiResponse
    );

    const admin = await usersDB.findOne({ role: "admin" });

    // implement send messages
    const session = await mongoose.startSession();
    session.startTransaction();

    const adminId = admin.id;
    const userId = user.id;

    const userIds = [adminId, userId];
    const chatsCurrently = await chatsDB.findOne({
      userIds: { $size: 2, $all: userIds },
    });

    let currentChat = null;
    if (!chatsCurrently) {
      async function createChatroomAndChats() {
        try {
          const chatRoomId = generateRandomId();
          const chatId = generateRandomId();
          const creationDate = Date.now();

          // if chat is empty
          const newChats = new chatsDB({
            chatId,
            chatRoomId,
            unreadCount: {
              [`${userIds[0]}`]: 0,
              [`${userIds[1]}`]: 0,
            },
            latestMessageTimestamp: 0,
            chatCreationDate: creationDate,
            userIds: userIds,
          });

          await newChats.save({ session });

          await session.commitTransaction();
          session.endSession();

          return {
            message: "Chat room data",
            ...newChats?._doc,
          };
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          return error;
        }
      }

      const result = await createChatroomAndChats();
      if (!result?.chatId) {
        next(result);
        return;
      }
      currentChat = result;
    } else {
      currentChat = chatsCurrently;
      await session.abortTransaction();
      session.endSession();
    }

    const chatRoomId = currentChat?.chatRoomId;
    const chatId = currentChat?.chatId;

    const senderUserId = adminId;
    const recipientProfileId = userId;

    const latestMessageTimestamp = Date.now();
    const messageId = generateRandomId(15);

    await templateSendMessage({
      chatRoomId,
      chatId,
      senderUserId,
      recipientProfileId,
      latestMessageTimestamp,
      messageId,
      status: "UNREAD",
      messageType: "text",
      textMessage: aiResponse,
      orderData: {
        type: agenda_name_paymentNotifResponse,
        orders: [
          {
            ...order._doc,
            status: "Diproses",
          },
        ],
      },
      role: "model",
      client,
      io,
      recipientProfileId,
    });
  } catch (error) {
    console.log("Error push notify payment response : ", error);
  }
};

const handleAutomaticCancelOrderOfProcessingStatus = async (
  { orderId: orderPublicId, agenda_id }, // Rename orderId to orderPublicId to avoid confusion with MongoDB _id
  io,
  socket, // Ini sepertinya tidak digunakan di sini, tapi saya biarkan
  client, // Ini sepertinya tidak digunakan di sini, tapi saya biarkan
  agenda
) => {
  let responseMessage = ""; // Variabel untuk menyimpan pesan respons

  try {
    const order = await Order.findOne({ orderId: orderPublicId });

    if (!order) {
      console.log(
        `Order not found with orderId "${orderPublicId}" in automatic cancel order processing status handler.`
      );
      responseMessage = `Order with ID ${orderPublicId} not found.`;
      // Anda mungkin ingin mengirim notifikasi admin di sini
      return; // Hentikan eksekusi
    }

    const user = await usersDB.findById(order.user); // Use findById as order.user is likely a MongoDB _id
    if (!user) {
      console.log(
        `User not found with _id "${order.user}" for order "${orderPublicId}" in automatic cancel order processing status handler.`
      );
      responseMessage = `User for order ${orderPublicId} not found.`;
      // Anda mungkin ingin mengirim notifikasi admin di sini
      return; // Hentikan eksekusi
    }

    // Hitung waktu sejak order berstatus "processing"
    // Asumsi 'processedAt' adalah field timestamp saat order menjadi 'processing'
    // Jika tidak ada, Anda bisa menggunakan 'updatedAt' atau 'orderedAt' dan menghitung selisihnya
    const timeSinceProcessedMinutes = order.processedAt
      ? Math.floor((new Date() - order.processedAt) / (1000 * 60))
      : Math.floor((new Date() - order.createdAt) / (1000 * 60)); // Fallback jika processedAt tidak ada

    // Alasan pelanggan diasumsikan ada di field order.customerReason atau sejenisnya
    const customerReason =
      order.cancelReason || "Tidak ada alasan spesifik diberikan";

    const instruction = {
      text: `Anda adalah sistem otomatis untuk validasi kelayakan pembatalan pesanan pelanggan. Tugas Anda adalah menentukan apakah suatu pesanan memenuhi syarat untuk dibatalkan berdasarkan alasan yang diberikan pelanggan dan waktu sejak pesanan tersebut berstatus "Diproses"`,
    };

    const suggestedPrompt = {
      text: `Untuk melakukan validasi, ikuti langkah-langkah berikut:

      1. **Periksa Alasan Pelanggan:**
         - Jika alasan pelanggan yaitu terindentifikasi spam seperti kalimat yang tidak jelas dan tidak dapat dipahami, pesanan TIDAK DAPAT dibatalkan. (Gunakan rejectionType: "spam_reason")
         - Jika alasan pelanggan adalah "Produk tidak cocok" atau "Salah memilih produk", pesanan DAPAT dibatalkan.
         - Jika alasan pelanggan berbeda dari yang disebutkan di atas, Anda harus meminta klarifikasi lebih lanjut. (Gunakan rejectionType: "clarification_needed" dan sertakan detail klarifikasi)
         - Jika alasan pelanggan berupa laporan bahwa pesanan tersebut memiliki arti melaporkan terjadi adanya spam seperti contoh : Spam (Pesanan tidak saya buat). maka pesanan DAPAT dibatalkan.

      2. **Periksa Waktu Sejak Pesanan Diproses:**
         - Jika waktu sejak pesanan berstatus "Diproses" lebih dari 30 menit, pesanan TIDAK DAPAT dibatalkan. (Gunakan rejectionType: "time_limit_exceeded")
         - Jika waktu sejak pesanan berstatus "Diproses" kurang dari atau sama dengan 30 menit, lanjutkan ke langkah berikutnya.

      3. **Output:**
         - Jika pesanan dapat dibatalkan (alasan valid dan waktu <= 30 menit), panggil fungsi \`confirmCancellation\` dengan rincian pesanan.
         - Jika pesanan tidak dapat dibatalkan (alasan 'Spam' ATAU waktu > 30 menit ATAU alasan tidak jelas), panggil fungsi \`rejectCancellation\` dengan rincian pesanan dan tipe penolakan yang sesuai.

      Berikut adalah informasi pesanan:
      * Order ID: ${order.orderId}
      * Alasan Pelanggan: ${customerReason}
      * Waktu Sejak Pesanan Diproses: ${timeSinceProcessedMinutes} menit
      * Data Order: ${JSON.stringify(order)}
      `,
    };

    const validateOrder = await genAI.models.generateContent({
      model: "gemini-2.5-flash", // Menggunakan model yang mendukung function calling
      contents: [
        {
          role: "user",
          parts: [suggestedPrompt],
        },
      ],
      config: {
        tools: [
          {
            functionDeclarations:
              automatedCancelOrderOfProcessingStatusTools.functionDeclarations,
          },
        ],
        systemInstruction: [instruction],
      },
    });

    const aiValidateOrderResponse = validateOrder.text; // Ambil teks respons dari AI (jika tidak ada function call)
    console.log(
      "AI Generated Raw Response 'Automatic cancel order processing status response TEXT':",
      aiValidateOrderResponse
    );

    let updatedOrder = null; // Variable untuk menyimpan order yang diupdate

    if (validateOrder.functionCalls && validateOrder.functionCalls.length > 0) {
      const functionCall = validateOrder.functionCalls[0];
      const functionName = functionCall.name;
      const functionArgs = functionCall.args;

      console.log(
        `AI called function: ${functionName} with args:`,
        functionArgs
      );

      if (functionName === "confirmCancellation") {
        // Logika untuk mengupdate status menjadi "cancelled"
        updatedOrder = await Order.findByIdAndUpdate(
          order._id,
          {
            $set: { status: "cancelled", cancelledAt: new Date() },
            $unset: { agendaJobId: "" }, // Hapus agendaJobId setelah job selesai
          },
          { new: true }
        );
        responseMessage = `
        Pembatalan Pesanan Disetujui! ✅
        
        Pembatalan pesanan #${order.orderId} disetujui. Status diubah menjadi 'cancelled'.`;

        // Panggil fungsi `confirmCancellation` lokal untuk konsol log atau return detail
        // confirmCancellation(order.orderId, customerReason, timeSinceProcessedMinutes);
      } else if (functionName === "rejectCancellation") {
        // Logika untuk mengupdate status berdasarkan "previousStatus"
        let newStatus = order.previousStatus || "processing"; // Default ke 'processing' jika previousStatus tidak ada

        updatedOrder = await Order.findByIdAndUpdate(
          order._id,
          {
            $set: { status: newStatus },
            $unset: { agendaJobId: "" }, // Hapus agendaJobId setelah job selesai
          },
          { new: true }
        );

        // Panggil fungsi `rejectCancellation` lokal untuk konsol log atau return detail
        // rejectCancellation(order.orderId, customerReason, timeSinceProcessedMinutes, functionArgs.rejectionType, functionArgs.clarificationDetail);

        if (functionArgs.rejectionType === "clarification_needed") {
          responseMessage = `
          Pembatalan Pesanan Ditolak ❌

          Permintaan pembatalan pesanan #${
            order.orderId
          } dengan klarifikasi sistem: ${
            functionArgs.clarificationDetail || "Alasan tidak jelas."
          } Status dikembalikan ke '${newStatus}'.`;
        } else {
          responseMessage = `
            Pembatalan Pesanan Ditolak ❌

            Permintaan pembatalan pesanan #${order.orderId} ditolak. Status dikembalikan ke '${newStatus}'. Alasan: ${functionArgs.rejectionType}.`;
        }
      } else {
        // Fallback jika AI memanggil fungsi yang tidak dikenal (seharusnya tidak terjadi jika tools didefinisikan dengan baik)
        console.warn(
          `AI called unknown function: ${functionName}. No order status update performed.`
        );
        responseMessage = `Terjadi kesalahan dalam pemrosesan pembatalan order ${order.orderId}.`;
      }

      console.log(`Order ${order.orderId} updated successfully.`);
      console.log(
        `New Order Status: ${updatedOrder ? updatedOrder.status : order.status}`
      );

      const userConfirmContent = await genAI.models.generateContent({
        model: "gemini-2.5-flash", // Menggunakan model yang mendukung function calling
        contents: [
          {
            role: "user",
            parts: [
              { text: responseMessage },
              {
                text: `Ini adalah data ordernya: ${JSON.stringify(
                  updatedOrder.toObject()
                )}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: [
            {
              text: `Anda adalah sistem yang memenuhi response dari model bahwa pesanan tersebut berhasil "Dibatalkan" atau statusnya di lanjutkan dalam proses sebelumnya yaitu "Diproses" karena alasan customer tidak sesuai dengan ketentuan persyaratan kami.`,
            },
            {
              text: `Gunakan informasi ini dengan style inline CSS:
        - Tanpa warna background dan tanpa border untuk div utama.
        - Jika status "Diproses", gunakan <span style="color: oklch(42.4% 0.199 265.638); font-size: 13px;">"Diproses"</span>.
        - Jika status "Dibatalkan", <span style="color: oklch(57.7% 0.245 27.325)">"Dibatalkan"</span>.
        - Maksimal font-size: 14px.
        - Jika status "cancelled", gunakan warna teks: oklch(57.7% 0.245 27.325).
        - Untuk daftar, gunakan <ul style="list-style-type: disc; margin-left: 20px; padding: 0;">.
        - Untuk daftar bersarang (anak), gunakan <ul style="list-style-type: circle; margin-left: 20px; padding: 0;">.`,
            },
          ],
        },
      });
      const aiUserConfirmContentResponse = userConfirmContent.text;

      console.log(
        `[PushNotif] Notification sent to user ${user._id} for order ${order.orderId}.`
      );

      const admin = await usersDB.findOne({ role: "admin" });

      // implement send messages
      const session = await mongoose.startSession();
      session.startTransaction();

      const adminId = admin.id;
      const userId = user.id;

      const userIds = [adminId, userId];
      const chatsCurrently = await chatsDB.findOne({
        userIds: { $size: 2, $all: userIds },
      });

      let currentChat = null;
      if (!chatsCurrently) {
        async function createChatroomAndChats() {
          try {
            const chatRoomId = generateRandomId();
            const chatId = generateRandomId();
            const creationDate = Date.now();

            // if chat is empty
            const newChats = new chatsDB({
              chatId,
              chatRoomId,
              unreadCount: {
                [`${userIds[0]}`]: 0,
                [`${userIds[1]}`]: 0,
              },
              latestMessageTimestamp: 0,
              chatCreationDate: creationDate,
              userIds: userIds,
            });

            await newChats.save({ session });

            await session.commitTransaction();
            session.endSession();

            return {
              message: "Chat room data",
              ...newChats?._doc,
            };
          } catch (error) {
            await session.abortTransaction();
            session.endSession();
            return error;
          }
        }

        const result = await createChatroomAndChats();
        if (!result?.chatId) {
          next(result);
          return;
        }
        currentChat = result;
      } else {
        currentChat = chatsCurrently;
        await session.abortTransaction();
        session.endSession();
      }

      const chatRoomId = currentChat?.chatRoomId;
      const chatId = currentChat?.chatId;

      const senderUserId = adminId;
      const recipientProfileId = userId;

      const latestMessageTimestamp = Date.now();
      const messageId = generateRandomId(15);

      await templateSendMessage({
        chatRoomId,
        chatId,
        senderUserId,
        recipientProfileId,
        latestMessageTimestamp,
        messageId,
        status: "UNREAD",
        messageType: "text",
        textMessage: aiUserConfirmContentResponse,
        orderData: {
          type: agenda_name_automaticOrderCancelOfProcessingStatus,
          orders: [
            {
              ...updatedOrder.toObject(),
              status:
                updatedOrder.status === "processing"
                  ? "Diproses"
                  : "Dibatalkan",
            },
          ],
        },
        role: "model",
        client,
        io,
        recipientProfileId,
      });

      const objectAgendaId = new mongoose.Types.ObjectId(agenda_id);
      await agenda.cancel({ _id: objectAgendaId });
    } else {
      // Jika AI tidak memanggil fungsi, berarti AI tidak dapat membuat keputusan berdasarkan prompt.
      // Ini bisa terjadi jika prompt tidak cukup jelas atau data tidak sesuai.
      const objectAgendaId = new mongoose.Types.ObjectId(agenda_id);
      await agenda.cancel({ _id: objectAgendaId });

      responseMessage = `Sistem tidak dapat mengotomatiskan keputusan pembatalan pesanan #${order.orderId} saat ini. functionCall : ${validateOrder.functionCalls}`;
      console.log("No functionCalls :", responseMessage);
    }
  } catch (error) {
    const objectAgendaId = new mongoose.Types.ObjectId(agenda_id);
    await agenda.cancel({ _id: objectAgendaId });
    console.error(
      "Error in handleAutomaticCancelOrderOfProcessingStatus:",
      error
    );
    responseMessage = `Terjadi kesalahan internal saat memproses pembatalan pesanan #${orderPublicId}.`;
  }
};

const chatRoom = {
  handleDisconnected,
  handleGetSendMessage,
  markMessageAsRead,
  handleGetNewMessageForBot,
  handlePushNotifResponseCancelOrder,
  handlePushNotifPaymentResponse,
  handleAutomaticCancelOrderOfProcessingStatus,
};

module.exports = {
  chatRoom,
  sendMessage,
  handleSendMessageFromAI,
};
