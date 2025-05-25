const { HTTP_STATUS_CODE } = require("../constant");
const chats = require("../models/chats");
const usersDB = require("../models/users");

exports.getChatsPagination = async (req, res, next) => {
  try {
    const { userId, limit = 20, chatId, search = "" } = req.query;

    if (!userId || !userId.trim()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: "userId required",
      });
    }

    const limitNumber = parseInt(limit);
    let anchorTimestamp = null;

    // Cari userId dari hasil search username (jika ada search query)
    let matchedUserIdsFromUsername = [];

    if (search) {
      const matchedUsers = await usersDB
        .find({
          username: { $regex: search, $options: "i" },
          id: { $ne: userId }, // validasi: tidak termasuk userId sendiri
        })
        .select("id");

      matchedUserIdsFromUsername = matchedUsers.map((user) => user.id);
    }

    // Ambil timestamp dari chatId anchor (jika ada)
    if (chatId) {
      const anchorChat = await chats.aggregate([
        {
          $match: {
            chatId: chatId,
            userIds: { $in: [userId] },
            latestMessage: { $exists: true, $ne: [] },
          },
        },
        {
          $addFields: {
            latestUserMessage: {
              $first: {
                $filter: {
                  input: "$latestMessage",
                  as: "msg",
                  cond: { $eq: ["$$msg.userId", userId] },
                },
              },
            },
          },
        },
        {
          $project: {
            latestUserMessageTimestamp: {
              $toLong: "$latestUserMessage.latestMessageTimestamp",
            },
          },
        },
      ]);

      if (anchorChat.length > 0) {
        anchorTimestamp = anchorChat[0].latestUserMessageTimestamp;
      }
    }

    // Pipeline dasar
    const basePipeline = [
      {
        $match: {
          userIds: { $in: [userId] },
          latestMessage: { $exists: true, $ne: [] },
          ...(search && {
            $or: [
              ...(matchedUserIdsFromUsername.length > 0
                ? [{ userIds: { $in: matchedUserIdsFromUsername } }]
                : []),
              {
                latestMessage: {
                  $elemMatch: {
                    $or: [
                      { textMessage: { $regex: search, $options: "i" } },
                      { "document.caption": { $regex: search, $options: "i" } },
                    ],
                  },
                },
              },
            ],
          }),
        },
      },
      {
        $addFields: {
          latestUserMessage: {
            $first: {
              $filter: {
                input: "$latestMessage",
                as: "msg",
                cond: { $eq: ["$$msg.userId", userId] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          latestUserMessageTimestamp: {
            $toLong: "$latestUserMessage.latestMessageTimestamp",
          },
        },
      },
    ];

    if (anchorTimestamp !== null) {
      basePipeline.push({
        $match: {
          $expr: {
            $lt: ["$latestUserMessageTimestamp", anchorTimestamp],
          },
        },
      });
    }

    // Hitung total
    const countPipeline = [...basePipeline, { $count: "total" }];
    const totalResult = await chats.aggregate(countPipeline);
    const totalData = totalResult[0]?.total ?? 0;

    // Pagination
    const paginatedPipeline = [
      ...basePipeline,
      { $sort: { latestUserMessageTimestamp: -1 } },
      { $limit: limitNumber },
    ];

    const chatsCurrently = await chats.aggregate(paginatedPipeline);
    const isNext = chatsCurrently.length === limitNumber;

    return res.status(HTTP_STATUS_CODE.OK).json({
      message: "Chats Data",
      data: chatsCurrently,
      totalData,
      limit: limitNumber,
      itemCount: chatsCurrently.length,
      isNext,
      nextChatId: chatsCurrently[chatsCurrently.length - 1]?.chatId ?? null,
    });
  } catch (error) {
    next(error);
    console.error("Error in getChatsPagination:", error);
  }
};

exports.getChats = async (req, res) => {
  const { userId } = req.query;

  if (!userId || !userId.trim()) {
    res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
      message: "userId required",
    });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let buffer = [];

  try {
    const cursor = chats
      .find({
        userIds: { $in: [userId] },
        latestMessage: { $exists: true },
      })
      .sort({ latestMessageTimestamp: -1 })
      .batchSize(40)
      .cursor();

    for await (const doc of cursor) {
      buffer.push(doc);

      if (buffer.length >= 20) {
        res.write(`data: ${JSON.stringify(buffer)}\n\n`);
        buffer = [];
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Kirim sisa data kalau ada (kurang dari 50)
    if (buffer.length > 0) {
      res.write(`data: ${JSON.stringify(buffer)}\n\n`);
    }

    // Kirim event selesai
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  } catch (error) {
    console.error("Error streaming:", error);
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: "Internal Error" })}\n\n`
    );
    res.end();
  }
};

// exports.getChats = async (req, res, next) => {
//     const { userId } = req.query

//     if (!userId || !userId.trim()) {
//         res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
//             message: 'userId required'
//         })
//         return
//     }

//     const chatsCurrently = await chats.find({
//         userIds: { $in: [userId] },
//         latestMessage: { $exists: true }
//     }).sort({ latestMessageTimestamp: -1 })

//     res.status(HTTP_STATUS_CODE.OK).json({
//         message: 'Chats Data',
//         data: chatsCurrently
//     })
// }
