const chatRoomDB = require("../models/chatRoom");
const chatsDB = require("../models/chats");
const usersDB = require("../models/users");
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
const { processNewMessageWithAI } = require("../utils/gemini");

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

const handleSendMessageFromAI = async (
  generatedText,
  message,
  latestMessageTimestamp,
  { io, socket, client, agenda, newMessageId }
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
        generatedText ??
        "Maaf kami tidak tersedia untuk saat ini. Mohon coba lagi nanti.",
    },
    recipientProfileId: newRecipientProfileId,
    role: "admin",
  };

  const isAvailableMessage = await chatRoomDB.findOne({
    chatId,
    chatRoomId,
    messageId: newMessageId,
  });

  if (!isAvailableMessage?._id) {
    await sendMessage(newMessageForUser, io, socket, client, agenda, false);
  } else {
    isAvailableMessage.textMessage = generatedText;
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
    }
    if (existingIndexUserId2 !== -1) {
      updatedLatestMessages[existingIndexUserId2].textMessage = generatedText;
    }

    updatedLatestMessages = updatedLatestMessages.filter(
      (item) => item?.userId
    );

    await chatsDB.updateOne(
      { chatRoomId, chatId },
      {
        latestMessage: updatedLatestMessages,
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
      messageUpdated: newMessageForUser.latestMessage,
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

  if (role === "admin" || latestMessage?.messageType !== "text") {
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

  await processNewMessageWithAI(
    [],
    message,
    async (
      responseText,
      message,
      latestMessageTimestamp,
      { io, socket, client, agenda, newMessageId }
    ) => {
      const result = await handleSendMessageFromAI(
        responseText,
        message,
        latestMessageTimestamp,
        { io, socket, client, agenda, newMessageId }
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

const createScheduleBotMessage = async (
  message,
  io,
  socket,
  agenda,
  client
) => {
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
    "in 1 minutes",
    "sendMessageToCustomer",
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
  usingBot = true
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
    userId: chatsCurrently.userIds[0],
    timeId,
  };
  const latestMessageWithUserId2 = {
    ...latestMessage,
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

  await chatsDB.updateOne(
    { chatRoomId, chatId },
    {
      unreadCount: newUnreadCount,
      latestMessage: updatedLatestMessages,
    },
    { new: true }
  );

  const senderUserId = updatedLatestMessages.find(
    (msg) => msg.userId !== recipientProfileId
  );
  const senderUserProfile = await usersDB.findOne({ id: senderUserId?.userId });

  // if (usingBot) {
  //   // handleGetNewMessageForBot(message, io, socket, client, agenda);
  //   await createScheduleBotMessage(message, io, socket, agenda, client);
  // }
  await createScheduleBotMessage(message, io, socket, agenda, client);

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

const chatRoom = {
  handleDisconnected,
  handleGetSendMessage,
  markMessageAsRead,
  handleGetNewMessageForBot,
};

module.exports = {
  chatRoom,
  sendMessage,
  handleSendMessageFromAI,
};
