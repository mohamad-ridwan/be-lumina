const mongoose = require("mongoose");
const chats = require("../models/chats");
const chatRoom = require("../models/chatRoom");
const { HTTP_STATUS_CODE } = require("../constant");
const { generateRandomId } = require("../helpers/generateRandomId");
const {
  uploadVideoService,
  uploadImageService,
} = require("../services/chatRoom/uploadFileService");
const { getSortTimestampAggregationField } = require("../helpers/general");

exports.uploadMediaMessage = async (req, res) => {
  const message = JSON.parse(req.body.message);
  if (message?.latestMessage?.document?.type === "video") {
    uploadVideoService(req, res);
  } else if (message?.latestMessage?.document?.type === "image") {
    uploadImageService(req, res);
  }
};

exports.getMessagesAround = async (req, res) => {
  const { chatRoomId, messageId } = req.params;
  const { profileId, recipientId } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Default 50, max 100

  if (!profileId || !recipientId) {
    return res
      .status(400)
      .json({ error: "Missing profileId or recipientId in query" });
  }

  const queryMediaOnProgress = {
    $and: [
      { senderUserId: { $ne: profileId } }, // senderUserId BUKAN profileId saat ini
      { "document.isProgressDone": false }, // document.isProgressDone adalah true
    ],
  };
  const queryMediaOnCancelled = {
    $and: [
      { senderUserId: { $ne: profileId } }, // senderUserId BUKAN profileId saat ini
      { "document.isCancelled": true }, // document.isProgressDone adalah true
    ],
  };

  const queryMediaOnProgressRecipient = {
    $and: [
      { senderUserId: { $ne: recipientId } }, // senderUserId BUKAN profileId saat ini
      { "document.isProgressDone": false }, // document.isProgressDone adalah true
    ],
  };
  const queryMediaOnCancelledRecipient = {
    $and: [
      { senderUserId: { $ne: recipientId } }, // senderUserId BUKAN profileId saat ini
      { "document.isCancelled": true }, // document.isProgressDone adalah true
    ],
  };

  const baseFilterConditions = () => ({
    chatRoomId,
    messageId,
    $nor: [
      {
        isDeleted: {
          $elemMatch: {
            senderUserId: profileId,
            deletionType: { $in: ["me", "permanent", "everyone"] },
          },
        },
      },
      {
        isDeleted: {
          $elemMatch: {
            senderUserId: recipientId,
            deletionType: { $in: ["everyone", "permanent"] },
          },
        },
      },
      queryMediaOnProgress,
      queryMediaOnCancelled,
      queryMediaOnProgressRecipient,
      queryMediaOnCancelledRecipient,
    ],
  });

  try {
    // Ambil pesan target
    const targetMessage = await chatRoom.findOne(baseFilterConditions());

    if (!targetMessage) {
      return res
        .status(404)
        .json({ error: "Message not found or already deleted for this user" });
    }

    const targetTimestamp =
      targetMessage?.senderUserId !== profileId &&
      targetMessage?.completionTimestamp
        ? Number(targetMessage.completionTimestamp)
        : Number(targetMessage.latestMessageTimestamp);
    const targetMessageId = targetMessage.messageId;
    const halfLimit = Math.floor(limit / 2);

    // 2. Ambil Pesan Sebelum Target (Menggunakan Aggregation)
    const beforePipeline = [
      {
        $match: {
          chatRoomId,
          $nor: [
            {
              isDeleted: {
                $elemMatch: {
                  senderUserId: profileId,
                  deletionType: { $in: ["me", "permanent"] },
                },
              },
            },
            queryMediaOnProgress,
            queryMediaOnCancelled,
          ],
        },
      }, // Filter dasar yang sudah di-refactor
      {
        $addFields: {
          sortTimestamp: getSortTimestampAggregationField(profileId),
        },
      },
      {
        $match: {
          $or: [
            { sortTimestamp: { $lt: targetTimestamp } }, // Lebih lama dari target
            {
              sortTimestamp: targetTimestamp,
              messageId: { $lt: targetMessageId }, // Jika timestamp sama, urutkan berdasarkan messageId
            },
          ],
        },
      },
      { $sort: { sortTimestamp: -1, messageId: -1 } }, // Urutkan descending untuk ambil yang paling dekat ke target
      { $limit: halfLimit },
    ];

    // Ambil pesan sebelum target
    // let beforeMessages = await chatRoom
    //   .find({
    //     chatRoomId,
    //     $nor: [
    //       {
    //         isDeleted: {
    //           $elemMatch: {
    //             senderUserId: profileId,
    //             deletionType: { $in: ["me", "permanent"] },
    //           },
    //         },
    //       },
    //       queryMediaOnProgress,
    //       queryMediaOnCancelled,
    //     ],
    //     $or: [
    //       { latestMessageTimestamp: { $lt: targetTimestamp } },
    //       {
    //         latestMessageTimestamp: targetTimestamp,
    //         messageId: { $lt: targetMessageId },
    //       },
    //     ],
    //   })
    //   .sort({ latestMessageTimestamp: -1, messageId: -1 })
    //   .limit(halfLimit);

    let beforeMessages = await chatRoom.aggregate(beforePipeline);

    // Jika pesan teratas adalah header, ambil 1 tambahan di bawahnya
    if (beforeMessages.length > 0 && beforeMessages[0]?.isHeader === true) {
      const topMessage = beforeMessages[beforeMessages.length - 1];

      const topMessageSortTimestamp = topMessage.sortTimestamp;
      const topMessageId = topMessage.messageId;

      const extraPipeline = [
        {
          $match: {
            chatRoomId,
            $nor: [
              {
                isDeleted: {
                  $elemMatch: {
                    senderUserId: profileId,
                    deletionType: { $in: ["me", "permanent"] },
                  },
                },
              },
              queryMediaOnProgress,
              queryMediaOnCancelled,
            ],
          },
        },
        {
          $addFields: {
            sortTimestamp: getSortTimestampAggregationField(profileId),
          },
        },
        {
          $match: {
            $or: [
              { sortTimestamp: { $lt: topMessageSortTimestamp } },
              {
                sortTimestamp: topMessageSortTimestamp,
                messageId: { $lt: topMessageId },
              },
            ],
          },
        },
        { $sort: { sortTimestamp: -1, messageId: -1 } },
        { $limit: 1 },
      ];

      // const extraMessage = await chatRoom
      //   .findOne({
      //     chatRoomId,
      //     $nor: [
      //       {
      //         isDeleted: {
      //           $elemMatch: {
      //             senderUserId: profileId,
      //             deletionType: { $in: ["me", "permanent"] },
      //           },
      //         },
      //       },
      //       queryMediaOnProgress,
      //       queryMediaOnCancelled,
      //     ],
      //     $or: [
      //       {
      //         latestMessageTimestamp: {
      //           $lt: topMessage.latestMessageTimestamp,
      //         },
      //       },
      //       {
      //         latestMessageTimestamp: topMessage.latestMessageTimestamp,
      //         messageId: { $lt: topMessage.messageId },
      //       },
      //     ],
      //   })
      //   .sort({ latestMessageTimestamp: -1, messageId: -1 });
      const [extraMessage] = await chatRoom.aggregate(extraPipeline);

      if (extraMessage) {
        beforeMessages.push(extraMessage);
      }
    }

    // Ambil pesan sesudah target
    const afterLimit = limit - beforeMessages.length - 1;

    const afterPipeline = [
      {
        $match: {
          chatRoomId,
          $nor: [
            {
              isDeleted: {
                $elemMatch: {
                  senderUserId: profileId,
                  deletionType: { $in: ["me", "permanent"] },
                },
              },
            },
            queryMediaOnProgress,
            queryMediaOnCancelled,
          ],
        },
      }, // Filter dasar
      {
        $addFields: {
          sortTimestamp: getSortTimestampAggregationField(profileId),
        },
      },
      {
        $match: {
          $or: [
            { sortTimestamp: { $gt: targetTimestamp } }, // Lebih baru dari target
            {
              sortTimestamp: targetTimestamp,
              messageId: { $gt: targetMessageId }, // Jika timestamp sama, urutkan berdasarkan messageId
            },
          ],
        },
      },
      { $sort: { sortTimestamp: 1, messageId: 1 } }, // Urutkan ascending
      { $limit: afterLimit > 0 ? afterLimit : 0 },
    ];

    // const afterMessages = await chatRoom
    //   .find({
    //     chatRoomId,
    //     $nor: [
    //       {
    //         isDeleted: {
    //           $elemMatch: {
    //             senderUserId: profileId,
    //             deletionType: { $in: ["me", "permanent"] },
    //           },
    //         },
    //       },
    //       queryMediaOnProgress,
    //       queryMediaOnCancelled,
    //     ],
    //     $or: [
    //       { latestMessageTimestamp: { $gt: targetTimestamp } },
    //       {
    //         latestMessageTimestamp: targetTimestamp,
    //         messageId: { $gt: targetMessageId },
    //       },
    //     ],
    //   })
    //   .sort({ latestMessageTimestamp: 1, messageId: 1 })
    //   .limit(afterLimit > 0 ? afterLimit : 0);

    const afterMessages = await chatRoom.aggregate(afterPipeline);

    // Gabungkan semua
    const result = [
      ...beforeMessages.reverse(),
      targetMessage,
      ...afterMessages,
    ];

    res.json({
      messages: result,
      targetMessageId: messageId,
      total: result.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getMediaMessagesAround = async (req, res) => {
  const { chatRoomId, messageId } = req.params;
  const { profileId, recipientId } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  if (!profileId || !recipientId) {
    return res
      .status(400)
      .json({ error: "Missing profileId or recipientId in query" });
  }

  const queryMediaOnProgress = {
    $and: [
      { senderUserId: { $ne: profileId } }, // senderUserId BUKAN profileId saat ini
      { "document.isProgressDone": false }, // document.isProgressDone adalah true
    ],
  };
  const queryMediaOnCancelled = {
    $and: [
      { senderUserId: { $ne: profileId } }, // senderUserId BUKAN profileId saat ini
      { "document.isCancelled": true }, // document.isProgressDone adalah true
    ],
  };

  const queryMediaOnProgressRecipient = {
    $and: [
      { senderUserId: { $ne: recipientId } }, // senderUserId BUKAN profileId saat ini
      { "document.isProgressDone": false }, // document.isProgressDone adalah true
    ],
  };
  const queryMediaOnCancelledRecipient = {
    $and: [
      { senderUserId: { $ne: recipientId } }, // senderUserId BUKAN profileId saat ini
      { "document.isCancelled": true }, // document.isProgressDone adalah true
    ],
  };

  const baseFilterConditions = () => ({
    chatRoomId,
    document: { $type: "object" },
    $nor: [
      {
        isDeleted: {
          $elemMatch: {
            senderUserId: profileId,
            deletionType: { $in: ["me", "permanent", "everyone"] },
          },
        },
      },
      {
        isDeleted: {
          $elemMatch: {
            senderUserId: recipientId,
            deletionType: { $in: ["everyone", "permanent"] },
          },
        },
      },
      queryMediaOnProgress,
      queryMediaOnCancelled,
      queryMediaOnProgressRecipient,
      queryMediaOnCancelledRecipient,
    ],
  });

  try {
    // Temukan pesan target yang merupakan media (punya field document)
    const targetMessage = await chatRoom.findOne({
      ...baseFilterConditions(),
      messageId,
    });

    if (!targetMessage) {
      return res
        .status(404)
        .json({ error: "Media message not found or deleted" });
    }

    const targetTimestamp =
      targetMessage.senderUserId !== profileId &&
      targetMessage.completionTimestamp
        ? Number(targetMessage.completionTimestamp)
        : Number(targetMessage.latestMessageTimestamp);
    const targetMessageId = targetMessage.messageId;
    const halfLimit = Math.floor(limit / 2);

    // 2. Ambil Media Sebelum Target
    const beforePipeline = [
      { $match: baseFilterConditions() }, // Filter dasar
      {
        $addFields: {
          sortTimestamp: getSortTimestampAggregationField(profileId),
        },
      },
      {
        $match: {
          $or: [
            { sortTimestamp: { $lt: targetTimestamp } }, // Lebih lama dari target
            {
              sortTimestamp: targetTimestamp,
              messageId: { $lt: targetMessageId }, // Jika timestamp sama, urutkan berdasarkan messageId
            },
          ],
        },
      },
      { $sort: { sortTimestamp: -1, messageId: -1 } }, // Urutkan descending untuk ambil yang paling dekat ke target
      { $limit: halfLimit },
    ];

    // Ambil media sebelum target
    // const beforeMessages = await chatRoom
    //   .find({
    //     chatRoomId,
    //     document: { $type: "object" },
    //     $nor: [
    //       {
    //         isDeleted: {
    //           $elemMatch: {
    //             senderUserId: profileId,
    //             deletionType: { $in: ["me", "permanent", "everyone"] },
    //           },
    //         },
    //       },
    //       {
    //         isDeleted: {
    //           $elemMatch: {
    //             senderUserId: recipientId,
    //             deletionType: { $in: ["everyone"] },
    //           },
    //         },
    //       },
    //       queryMediaOnProgress,
    //       queryMediaOnCancelled,
    //       queryMediaOnProgressRecipient,
    //       queryMediaOnCancelledRecipient,
    //     ],
    //     $or: [
    //       { latestMessageTimestamp: { $lt: targetTimestamp } },
    //       {
    //         latestMessageTimestamp: targetTimestamp,
    //         messageId: { $lt: targetMessageId },
    //       },
    //     ],
    //   })
    //   .sort({ latestMessageTimestamp: -1, messageId: -1 })
    //   .limit(halfLimit);
    const beforeMessages = await chatRoom.aggregate(beforePipeline);

    // Ambil media sesudah target
    const afterLimit = limit - beforeMessages.length - 1;

    const afterPipeline = [
      { $match: baseFilterConditions() }, // Filter dasar
      {
        $addFields: {
          sortTimestamp: getSortTimestampAggregationField(profileId),
        },
      },
      {
        $match: {
          $or: [
            { sortTimestamp: { $gt: targetTimestamp } }, // Lebih baru dari target
            {
              sortTimestamp: targetTimestamp,
              messageId: { $gt: targetMessageId }, // Jika timestamp sama, urutkan berdasarkan messageId
            },
          ],
        },
      },
      { $sort: { sortTimestamp: 1, messageId: 1 } }, // Urutkan ascending untuk ambil yang paling dekat ke target
      { $limit: afterLimit > 0 ? afterLimit : 0 },
    ];

    // const afterMessages = await chatRoom
    //   .find({
    //     chatRoomId,
    //     document: { $type: "object" },
    //     $nor: [
    //       {
    //         isDeleted: {
    //           $elemMatch: {
    //             senderUserId: profileId,
    //             deletionType: { $in: ["me", "permanent", "everyone"] },
    //           },
    //         },
    //       },
    //       {
    //         isDeleted: {
    //           $elemMatch: {
    //             senderUserId: recipientId,
    //             deletionType: { $in: ["everyone"] },
    //           },
    //         },
    //       },
    //       queryMediaOnProgress,
    //       queryMediaOnCancelled,
    //       queryMediaOnProgressRecipient,
    //       queryMediaOnCancelledRecipient,
    //     ],
    //     $or: [
    //       { latestMessageTimestamp: { $gt: targetTimestamp } },
    //       {
    //         latestMessageTimestamp: targetTimestamp,
    //         messageId: { $gt: targetMessageId },
    //       },
    //     ],
    //   })
    //   .sort({ latestMessageTimestamp: 1, messageId: 1 })
    //   .limit(afterLimit > 0 ? afterLimit : 0);

    const afterMessages = await chatRoom.aggregate(afterPipeline);

    // Gabungkan semuanya
    const result = [
      ...beforeMessages.reverse(),
      targetMessage,
      ...afterMessages,
    ];

    res.json({
      mediaMessages: result,
      targetMessageId: messageId,
      total: result.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getMessagesPagination = async (req, res, next) => {
  try {
    const {
      chatId,
      chatRoomId,
      messageId,
      direction,
      isFirstMessage,
      profileId,
    } = req.query;
    const limit = parseInt(req.query.limit) || 20;

    const queryMediaOnProgress = {
      $and: [
        { senderUserId: { $ne: profileId } }, // senderUserId BUKAN profileId saat ini
        { "document.isProgressDone": false }, // document.isProgressDone adalah true
      ],
    };
    const queryMediaOnCancelled = {
      $and: [
        { senderUserId: { $ne: profileId } }, // senderUserId BUKAN profileId saat ini
        { "document.isCancelled": true }, // document.isProgressDone adalah true
      ],
    };

    // --- LOGIC BARU UNTUK MENENTUKAN sortTimestamp ---
    const getSortTimestampField = () => {
      return {
        $cond: {
          if: {
            $and: [
              { $ne: ["$senderUserId", profileId] }, // Jika senderUserId BUKAN profileId
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
      // $nor array sekarang berisi dua kondisi pengecualian
      $nor: [
        // Kondisi 1: Pengecualian pesan yang dihapus oleh profileId saat ini
        {
          isDeleted: {
            $elemMatch: {
              senderUserId: profileId,
              deletionType: { $in: ["me", "permanent"] },
            },
          },
        },
        // Kondisi 2: Pengecualian pesan yang BUKAN dari profileId saat ini,
        //           DAN isProgressDone: true, DAN isCancelled: false
        queryMediaOnProgress,
        queryMediaOnCancelled,
      ],
    };

    if (isFirstMessage) {
      // const messages = await chatRoom
      //   .find(queryConditions)
      //   .sort({ latestMessageTimestamp: -1, isHeader: 1 })
      //   .limit(20);

      const messages = await chatRoom.aggregate([
        { $match: queryConditions },
        {
          $addFields: {
            // Membuat field 'sortTimestamp'
            sortTimestamp: getSortTimestampField(),
          },
        },
        { $sort: { sortTimestamp: -1, isHeader: 1 } }, // Urutkan berdasarkan sortTimestamp yang baru dibuat
        { $limit: 20 },
      ]);

      // ==== Cek apakah semua item adalah header ====
      const headers = messages.filter((msg) => msg.isHeader === true);
      const nonHeaders = messages.filter((msg) => !msg.isHeader);

      const nonHeaderTimeIds = new Set(
        nonHeaders.map((msg) => {
          if (msg?.senderUserId !== profileId && msg?.completionTimeId) {
            return msg.completionTimeId;
          }
          return msg.timeId;
        })
      );

      const headersWithoutMatchingNonHeader = headers.filter((header) => {
        if (header?.senderUserId !== profileId && header?.completionTimeId) {
          return !nonHeaderTimeIds.has(header.completionTimeId);
        }
        return !nonHeaderTimeIds.has(header.timeId);
      });

      const allItemsAreOrphanHeaders =
        messages.length > 0 &&
        messages.every((msg) => msg.isHeader === true) &&
        headersWithoutMatchingNonHeader.length === headers.length;

      if (allItemsAreOrphanHeaders) {
        return res.json({
          isFirstMessage,
          messages: [],
          totalMessages: 0,
        });
      } else {
        const messageNonHeaders = messages.filter((msg) => !msg?.isHeader);

        const headersTimeId = new Set(
          messageNonHeaders.map((msg) => {
            if (msg?.senderUserId !== profileId && msg?.completionTimeId) {
              return msg.completionTimeId;
            }
            return msg.timeId;
          })
        );

        const messagesCurrently = messages.filter((msg) => {
          if (msg?.senderUserId !== profileId && msg?.completionTimeId) {
            return headersTimeId.has(msg.completionTimeId);
          }
          return headersTimeId.has(msg.timeId);
        });

        return res.json({
          isFirstMessage,
          messages: messagesCurrently,
          totalMessages: messagesCurrently.length,
        });
      }
    }

    if (!chatId || !chatRoomId || !messageId || !direction) {
      return res
        .status(400)
        .json({ error: "Missing required query parameters." });
    }

    // Temukan anchor message berdasarkan messageId
    const anchor = await chatRoom
      .findOne({ chatId, chatRoomId, messageId })
      .lean();

    if (!anchor) {
      return res.status(404).json({ error: "Anchor message not found." });
    }

    const timestamp = Number(anchor.latestMessageTimestamp);

    // Tentukan anchorTimestamp berdasarkan logic baru
    const anchorTimestamp =
      anchor.senderUserId !== profileId && anchor.completionTimestamp
        ? Number(anchor.completionTimestamp)
        : Number(anchor.latestMessageTimestamp);

    let query = {};
    let sort = {};

    let pipeline = [];
    let sortOrder = 0; // Untuk sort di JS setelah fetching

    // ⛔️ FIXED: Tukar logika prev & next
    if (direction === "next") {
      // // Sebelumnya prev → sekarang jadi next
      // query = {
      //   chatId,
      //   chatRoomId,
      //   $nor: [
      //     {
      //       isDeleted: {
      //         $elemMatch: {
      //           senderUserId: profileId,
      //           deletionType: { $in: ["me", "permanent"] },
      //         },
      //       },
      //     },
      //     queryMediaOnProgress,
      //     queryMediaOnCancelled,
      //   ],
      //   latestMessageTimestamp: { $lt: timestamp },
      // };
      // sort = { latestMessageTimestamp: -1 };

      pipeline.push(
        { $match: queryConditions },
        {
          $addFields: {
            sortTimestamp: getSortTimestampField(),
          },
        },
        { $match: { sortTimestamp: { $lt: anchorTimestamp } } },
        { $sort: { sortTimestamp: -1 } }, // Ambil yang paling baru (lebih dekat ke anchor) dulu
        { $limit: limit }
      );
      sortOrder = 1; // Akan diurutkan ASCENDING (dari lama ke baru) di JS
    } else if (direction === "prev") {
      // // Sebelumnya next → sekarang jadi prev
      // query = {
      //   chatId,
      //   chatRoomId,
      //   $nor: [
      //     {
      //       isDeleted: {
      //         $elemMatch: {
      //           senderUserId: profileId,
      //           deletionType: { $in: ["me", "permanent"] },
      //         },
      //       },
      //     },
      //     queryMediaOnProgress,
      //     queryMediaOnCancelled,
      //   ],
      //   latestMessageTimestamp: { $gt: timestamp },
      // };
      // sort = { latestMessageTimestamp: 1 };

      pipeline.push(
        { $match: queryConditions },
        {
          $addFields: {
            sortTimestamp: getSortTimestampField(),
          },
        },
        { $match: { sortTimestamp: { $gt: anchorTimestamp } } },
        { $sort: { sortTimestamp: 1 } }, // Ambil yang paling lama (lebih dekat ke anchor) dulu
        { $limit: limit }
      );
      sortOrder = -1; // Akan diurutkan DESCENDING (dari baru ke lama) di JS
    } else {
      return res
        .status(400)
        .json({ error: 'Invalid direction. Use "prev" or "next".' });
    }

    // const messages = await chatRoom.find(query).sort(sort).limit(limit).lean();
    const messages = await chatRoom.aggregate(pipeline);

    const totalMessages = await chatRoom.countDocuments({ chatId, chatRoomId });

    const messageNonHeaders = messages.filter((msg) => !msg?.isHeader);
    const headersTimeId = new Set(
      messageNonHeaders.map((msg) => {
        if (msg?.senderUserId !== profileId && msg?.completionTimeId) {
          return msg.completionTimeId;
        }
        return msg.timeId;
      })
    );
    const messagesCurrently = messages.filter((msg) => {
      if (msg?.senderUserId !== profileId && msg?.completionTimeId) {
        return headersTimeId.has(msg.completionTimeId);
      }
      return headersTimeId.has(msg.timeId);
    });

    // const firstMessage = await chatRoom
    //   .findOne({ chatId, chatRoomId })
    //   .sort({ latestMessageTimestamp: 1 });

    const firstMessageDoc = await chatRoom.aggregate([
      { $match: queryConditions },
      { $addFields: { sortTimestamp: getSortTimestampField() } },
      { $sort: { sortTimestamp: 1 } },
      { $limit: 1 },
    ]);

    // const lastMessage = await chatRoom
    //   .findOne({ chatId, chatRoomId })
    //   .sort({ latestMessageTimestamp: -1 });

    const lastMessageDoc = await chatRoom.aggregate([
      { $match: queryConditions },
      { $addFields: { sortTimestamp: getSortTimestampField() } },
      { $sort: { sortTimestamp: -1 } },
      { $limit: 1 },
    ]);

    // const hasPrev = timestamp < Number(lastMessage.latestMessageTimestamp);
    // const hasNext = timestamp > Number(firstMessage.latestMessageTimestamp);
    const hasPrev =
      firstMessageDoc.length > 0 &&
      anchorTimestamp > Number(firstMessageDoc[0].sortTimestamp);
    const hasNext =
      lastMessageDoc.length > 0 &&
      anchorTimestamp < Number(lastMessageDoc[0].sortTimestamp);

    // ✅ Tetap balik jika dari arah 'next' (sekarang ambil dari paling baru → lama)
    // const sortedMessages =
    //   direction === "next" ? messagesCurrently.reverse() : messagesCurrently;

    // Sorting akhir di JavaScript berdasarkan `sortOrder`
    messagesCurrently.sort((a, b) => {
      const aSortTimestamp =
        a.senderUserId !== profileId && a.completionTimestamp
          ? Number(a.completionTimestamp)
          : Number(a.latestMessageTimestamp);
      const bSortTimestamp =
        b.senderUserId !== profileId && b.completionTimestamp
          ? Number(b.completionTimestamp)
          : Number(b.latestMessageTimestamp);

      if (aSortTimestamp === bSortTimestamp) {
        if (a.isHeader && !b.isHeader) return 1;
        if (!a.isHeader && b.isHeader) return -1;
        return 0;
      }
      return sortOrder === 1
        ? aSortTimestamp - bSortTimestamp
        : bSortTimestamp - aSortTimestamp;
    });

    return res.json({
      // data: sortedMessages
      //   .map((item) => ({
      //     ...item,
      //     latestMessageTimestamp: Number(item.latestMessageTimestamp),
      //   }))
      //   .sort((a, b) => {
      //     if (a.latestMessageTimestamp === b.latestMessageTimestamp) {
      //       if (a.isHeader && !b.isHeader) return 1;
      //       if (!a.isHeader && b.isHeader) return -1;
      //       return 0;
      //     }
      //     return b.latestMessageTimestamp - a.latestMessageTimestamp;
      //   }),
      data: messagesCurrently.map((item) => ({
        ...item,
        latestMessageTimestamp: Number(item.latestMessageTimestamp),
        completionTimestamp: item.completionTimestamp
          ? Number(item.completionTimestamp)
          : null,
      })),
      meta: {
        anchorMessageId: anchor.messageId,
        hasPrev,
        hasNext,
        totalMessages,
        // fetchedCount: sortedMessages.length,
        fetchCount: messagesCurrently.length,
        direction,
      },
    });
  } catch (err) {
    console.log("err-get-messages-pagination :", err);
    next(err);
  }
};

exports.stream = async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const { chatId, chatRoomId, profileId } = req.query;

  let allMessages = []; // Kita tampung semua dulu
  let totalMessages = 0;

  try {
    const cursor = chatRoom
      .find({
        chatId,
        chatRoomId,
        $nor: [
          {
            isDeleted: {
              $elemMatch: {
                senderUserId: profileId,
                deletionType: { $in: ["me", "permanent"] },
              },
            },
          },
        ],
      })
      .sort({ latestMessageTimestamp: -1, isHeader: 1 })
      .allowDiskUse(true)
      .batchSize(40)
      .cursor();

    for await (const doc of cursor) {
      const message = { ...doc._doc, id: doc._doc.messageId };
      allMessages.push(message);
    }

    // ==== Cek apakah semua item adalah header ====
    const headers = allMessages.filter((msg) => msg.isHeader === true);
    const nonHeaders = allMessages.filter((msg) => !msg.isHeader);

    const nonHeaderTimeIds = new Set(nonHeaders.map((msg) => msg.timeId));

    const headersWithoutMatchingNonHeader = headers.filter(
      (header) => !nonHeaderTimeIds.has(header.timeId)
    );

    const allItemsAreOrphanHeaders =
      allMessages.length > 0 &&
      allMessages.every((msg) => msg.isHeader === true) &&
      headersWithoutMatchingNonHeader.length === headers.length;

    if (allItemsAreOrphanHeaders) {
      // Kalau semua item adalah header → jangan kirim apapun
      res.write(
        `event: done\ndata: ${JSON.stringify({ totalMessages: 0 })}\n\n`
      );
      res.end();
      return;
    }

    // ==== Kalau tidak semua header, kirim data secara batch 20 ====
    for (let i = 0; i < allMessages.length; i += 20) {
      const batch = allMessages.slice(i, i + 20);
      res.write(`data: ${JSON.stringify(batch)}\n\n`);
      totalMessages += batch.length;
      await new Promise((resolve) => setTimeout(resolve, 500)); // Delay sama seperti sebelumnya
    }

    const totalMessageData = { totalMessages };
    res.write(`event: done\ndata: ${JSON.stringify(totalMessageData)}\n\n`);
    res.end();
  } catch (error) {
    console.error("Error streaming:", error);
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: "Internal Error" })}\n\n`
    );
    res.end();
  }
};

exports.getChatRoom = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const { userIds, mainUserId } = req.body;

  const isSameIds = userIds?.filter(
    (value, index) => userIds?.indexOf(value) !== index
  );

  let err = {};
  if (!mainUserId || !mainUserId.trim()) {
    err.mainUserId = "mainUserId required";
  } else if (!userIds || userIds.length !== 2 || isSameIds?.length > 0) {
    err.userIds = "Invalid userid error";
  }

  if (Object.keys(err).length > 0) {
    await session.abortTransaction();
    session.endSession();
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: Object.entries(err).map((p) => p[1])[0],
    });
    return;
  }

  // find existing chat
  const chatsCurrently = await chats.findOne({
    userIds: { $size: 2, $all: userIds },
  });

  // const cursor = chatRoom.findOne({userIds: { $size: 2, $all: userIds }}).batchSize(100).cursor()
  // const cursor = chatRoom.find().batchSize(2).cursor()
  // cursor.on('data',(data) => {
  //     console.log('data', data?._id);
  // })

  // if chat is already exist,
  // don't save to db
  if (chatsCurrently?._doc) {
    await session.commitTransaction();
    session.endSession();

    res.status(HTTP_STATUS_CODE.OK).json({
      message: "Chat room data",
      ...chatsCurrently._doc,
    });

    return;
  }

  async function createChatroomAndChats() {
    try {
      const chatRoomId = generateRandomId();
      const chatId = generateRandomId();
      const creationDate = Date.now();

      // if chat is empty
      const newChats = new chats({
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
  res.status(HTTP_STATUS_CODE.OK).json(result);
};

// exports.getChatRoom = async (req, res, next) => {
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     const { userIds, mainUserId } = req.body

//     const isSameIds = userIds?.filter((value, index) => userIds?.indexOf(value) !== index)

//     let err = {}
//     if (!mainUserId || !mainUserId.trim()) {
//         err.mainUserId = 'mainUserId required'
//     } else if (!userIds || userIds.length !== 2 || isSameIds?.length > 0) {
//         err.userIds = 'Invalid userid error'
//     }

//     if (Object.keys(err).length > 0) {
//         await session.abortTransaction();
//         session.endSession();
//         res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
//             message: Object.entries(err).map(p => p[1])[0]
//         })
//         return
//     }

//     // find existing chat
//     const chatsCurrently = await chats.findOne({
//         userIds: { $size: 2, $all: userIds },
//     });
//     const chatRoomCurrently = await chatRoom.findOne({
//         userIds: { $size: 2, $all: userIds },
//     })

//     // const cursor = chatRoom.findOne({userIds: { $size: 2, $all: userIds }}).batchSize(100).cursor()
//     // const cursor = chatRoom.find().batchSize(2).cursor()
//     // cursor.on('data',(data) => {
//     //     console.log('data', data?._id);
//     // })

//     // if chat is already exist,
//     // don't save to db
//     if (chatsCurrently?._doc) {
//         await session.commitTransaction();
//         session.endSession();

//         res.status(HTTP_STATUS_CODE.OK).json({
//             message: 'Chat room data',
//             ...chatRoomCurrently._doc
//         })

//         return
//     }

//     async function createChatroomAndChats() {
//         try {
//             const chatRoomId = generateRandomId()
//             const chatId = generateRandomId()
//             const creationDate = Date.now()

//             // if chat is empty
//             const newChats = new chats({
//                 chatId,
//                 chatRoomId,
//                 unreadCount: {
//                     [`${userIds[0]}`]: 0,
//                     [`${userIds[1]}`]: 0
//                 },
//                 latestMessageTimestamp: 0,
//                 chatCreationDate: creationDate,
//                 userIds: userIds,
//             })
//             const newChatRoom = new chatRoom({
//                 chatRoomId,
//                 chatId,
//                 data: [],
//                 chatRoomCreationDate: creationDate,
//                 userIds: userIds,
//             })

//             await newChats.save({ session })
//             await newChatRoom.save({ session })

//             await session.commitTransaction();
//             session.endSession();

//             return {
//                 message: 'Chat room data',
//                 ...newChatRoom?._doc
//             }
//         } catch (error) {
//             await session.abortTransaction();
//             session.endSession();
//             return error
//         }
//     }

//     const result = await createChatroomAndChats()
//     if (!result?.chatId) {
//         next(result)
//         return
//     }
//     res.status(HTTP_STATUS_CODE.OK).json(result)
// }
