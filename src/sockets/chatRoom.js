const chatRoomDB = require("../models/chatRoom");
const chatsDB = require("../models/chats");
const usersDB = require("../models/users");
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
  formatDate,
  generateBase64ThumbnailFromUrl,
} = require("../helpers/general");

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

async function isUserInRoom(chatId, chatRoomId, userId, client) {
  return await new Promise((resolve, reject) => {
    client
      .sCard(`chats:${chatId}:room:${chatRoomId}:users:${userId}`)
      .then((res) => {
        resolve(res > 0);
      })
      .catch((err) => reject(err));
  });
}

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

const sendMessage = async (message, io, socket, client) => {
  const { latestMessage, isNeedHeaderDate, recipientProfileId } = message;

  const chatRoomId = message?.chatRoomId;
  const chatId = message?.chatId;

  // Cari header yang ada hari ini
  const headerMessageToday = await getTodayHeader(chatId, chatRoomId);

  let timeId;
  let headerMessage;

  if (!headerMessageToday) {
    // ❌ Belum ada header → buat header baru
    timeId = generateRandomId(15);
    const headerId = generateRandomId(15);

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
    [secondUserId]: isSecondUserInRoom ? 0 : currentUnreadCount + 1,
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
      // latestMessageTimestamp: latestMessage?.latestMessageTimestamp
    },
    { new: true }
  );

  const senderUserId = updatedLatestMessages.find(
    (msg) => msg.userId !== recipientProfileId
  );
  const senderUserProfile = await usersDB.findOne({ id: senderUserId?.userId });

  // Emit header dulu kalau perlu (kondisi gabungan)
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
    });
    // io.emit("newMessage", {
    //   ...message,
    //   timeId,
    //   messageId: headerMessage.messageId,
    //   isHeader: true,
    //   latestMessageTimestamp: headerMessage.latestMessageTimestamp,
    // });
  }

  // Emit pesan biasa (seperti biasa)
  // io.emit('newMessage', {
  //   ...message,
  //   latestMessage: {
  //     ...message.latestMessage,
  //     timeId
  //   },
  //   unreadCount: newUnreadCount
  // })
  io.emit("newMessage", {
    ...message,
    username: senderUserProfile?.username,
    image: senderUserProfile?.image,
    imgCropped: senderUserProfile?.imgCropped,
    thumbnail: senderUserProfile?.thumbnail,
    latestMessage: updatedLatestMessages,
    unreadCount: newUnreadCount,
  });
};

// Fungsi tambahan → cari header untuk tanggal ini (sekalian ambil timeId)
const getTodayHeader = async (chatId, chatRoomId) => {
  const todayStart = dayjs().startOf("day").valueOf();
  const todayEnd = dayjs().endOf("day").valueOf();

  return await chatRoomDB.findOne({
    chatId,
    chatRoomId,
    isHeader: true,
    latestMessageTimestamp: { $gte: todayStart, $lte: todayEnd },
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
      const latestMessage = await chatRoomDB
        .findOne({
          chatId,
          chatRoomId,
          isHeader: { $ne: true },
          $nor: [
            {
              isDeleted: {
                $elemMatch: {
                  senderUserId: senderUserId,
                  deletionType: { $in: ["me", "permanent"] },
                },
              },
            },
          ],
        })
        .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
        .lean(); // optional: untuk dapat plain JS object
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
        const newLatestMessageMainUserId = await chatRoomDB
          .findOne({
            chatId,
            chatRoomId,
            isHeader: { $ne: true },
            $nor: [
              {
                isDeleted: {
                  $elemMatch: {
                    senderUserId: senderUserId,
                    deletionType: { $in: ["me", "permanent"] },
                  },
                },
              },
            ],
          })
          .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
          .lean();

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
          latestMessages.push(newLatestMessage);
          isMustUpdatedLatestMessages = true;
        }
      }

      if (latestMessageSecondUserId?.messageId === messageId) {
        const newLatestMessageSecondUserId = await chatRoomDB
          .findOne({
            chatId,
            chatRoomId,
            isHeader: { $ne: true },
            $nor: [
              {
                isDeleted: {
                  $elemMatch: {
                    senderUserId: secondProfileId,
                    deletionType: { $in: ["me", "permanent"] },
                  },
                },
              },
            ],
          })
          .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
          .lean();

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

    const latestMessageMainUserId = await chatRoomDB
      .findOne({
        chatId,
        chatRoomId,
        isHeader: { $ne: true },
        $nor: [
          {
            isDeleted: {
              $elemMatch: {
                senderUserId: senderUserId,
                deletionType: { $in: ["me", "permanent"] },
              },
            },
          },
        ],
      })
      .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
      .lean();

    let latestMessageSecondUserId = null;

    if (requestedDeletionType === "everyone") {
      latestMessageSecondUserId = await chatRoomDB
        .findOne({
          chatId,
          chatRoomId,
          isHeader: { $ne: true },
          $nor: [
            {
              isDeleted: {
                $elemMatch: {
                  senderUserId: secondProfileId,
                  deletionType: { $in: ["me", "permanent"] },
                },
              },
            },
          ],
        })
        .sort({ latestMessageTimestamp: -1 }) // urutkan dari yang terbaru
        .lean();
    }

    if (messageId === latestMessageMainUserId.messageId) {
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

const handleGetSendMessage = async (message, io, socket, client) => {
  if (message?.eventType === "send-message") {
    sendMessage(message, io, socket, client);
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
};

module.exports = { chatRoom, sendMessage };
