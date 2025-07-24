const { getTodayHeader, isUserInRoom } = require("./general");
const { generateRandomId } = require("./generateRandomId");
const ChatRoom = require("../models/chatRoom");
const Chats = require("../models/chats");
const User = require("../models/users");

const templateSendMessage = async ({
  chatRoomId,
  chatId,
  senderUserId,
  latestMessageTimestamp,
  messageId,
  status,
  messageType,
  textMessage,
  orderData,
  productData,
  role,
  client,
  document,
  io,
  eventType = "send-message",
  recipientProfileId,
}) => {
  // Cari header yang ada hari ini
  const headerMessageToday = await getTodayHeader(chatId, chatRoomId);

  let timeId;
  let headerMessage;
  let headerId;

  if (!headerMessageToday) {
    // ❌ Belum ada header → buat header baru
    timeId = generateRandomId(15);
    headerId = generateRandomId(15);

    headerMessage = new ChatRoom({
      chatId,
      chatRoomId,
      messageId: headerId,
      isHeader: true,
      senderUserId: senderUserId,
      latestMessageTimestamp: latestMessageTimestamp,
      timeId,
    });
    await headerMessage.save();
  } else {
    timeId = headerMessageToday.timeId;
    headerId = headerMessageToday.messageId;
  }

  const chatRoomData = {
    chatId,
    chatRoomId,
    messageId: messageId,
    senderUserId: senderUserId,
    messageType: messageType,
    textMessage: textMessage,
    latestMessageTimestamp: latestMessageTimestamp,
    status: status,
    timeId,
  };

  if (orderData?.orders?.length > 0) {
    chatRoomData.orderData = orderData;
  }
  if (role === "model") {
    chatRoomData.role = "model";
  }

  const newChatRoom = new ChatRoom(chatRoomData);
  await newChatRoom.save();

  // Update unread count
  const chatsCurrently = await Chats.findOne({ chatRoomId, chatId });
  const secondUserId = Object.keys(chatsCurrently?.unreadCount || {}).find(
    (id) => id !== senderUserId
  );
  const currentUnreadCount = chatsCurrently?.unreadCount?.[secondUserId] || 0;

  const isSecondUserInRoom = await isUserInRoom(
    chatId,
    chatRoomId,
    secondUserId,
    client
  );

  const newUnreadCount = {
    [senderUserId]: 0,
    [secondUserId]: isSecondUserInRoom
      ? 0
      : document
      ? currentUnreadCount
      : currentUnreadCount + 1,
  };

  // Update latestMessage sebagai array
  let updatedLatestMessages = Array.isArray(chatsCurrently.latestMessage)
    ? [...chatsCurrently.latestMessage]
    : [];

  const latestMessageWithUserId1 = {
    ...chatRoomData,
    productData: productData ?? null,
    orderData: orderData ?? null,
    userId: chatsCurrently.userIds[0],
    timeId,
  };
  const latestMessageWithUserId2 = {
    ...chatRoomData,
    productData: productData ?? null,
    orderData: orderData ?? null,
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

  await Chats.updateOne(
    { chatRoomId, chatId },
    {
      unreadCount: newUnreadCount,
      latestMessage: updatedLatestMessages,
    },
    { new: true }
  );

  const senderUserProfile = await User.findOne({ id: senderUserId });

  if (headerMessage?.messageId) {
    io.emit("newMessage", {
      chatId,
      chatRoomId,
      eventType: eventType,
      isNeedHeaderDate: true,
      recipientProfileId,
      timeId,
      role,
      messageId: headerMessage.messageId,
      isHeader: true,
      latestMessageTimestamp: headerMessage.latestMessageTimestamp,
      isFromMedia: document?.type ? true : null,
      senderUserId: senderUserId,
    });
  }

  io.emit("newMessage", {
    chatId: chatRoomData.chatId,
    chatRoomId: chatRoomData.chatRoomId,
    eventType: "send-message",
    isFromMedia: null,
    latestMessage: updatedLatestMessages,
    username: senderUserProfile?.username,
    recipientProfileId,
    role,
    image: senderUserProfile?.image,
    imgCropped: senderUserProfile?.imgCropped,
    thumbnail: senderUserProfile?.thumbnail,
    latestMessage: updatedLatestMessages,
    unreadCount: newUnreadCount,
    timeId,
    headerId,
  });
};

module.exports = { templateSendMessage };
