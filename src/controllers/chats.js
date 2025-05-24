const { HTTP_STATUS_CODE } = require("../constant");
const chats = require("../models/chats");

exports.getChatsPagination = async (req, res, next) => {
  try {
    const { userId, limit = 10, chatId } = req.query;

    if (!userId || !userId.trim()) {
      return res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
        message: "userId required",
      });
    }

    const limitNumber = parseInt(limit);
    let anchorTimestamp = null;

    // Cari timestamp dari chatId anchor (jika ada)
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

    // Pipeline dasar (untuk pagination + count)
    const basePipeline = [
      {
        $match: {
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

    // Hitung total data (tanpa pagination)
    const countPipeline = [...basePipeline, { $count: "total" }];
    const totalResult = await chats.aggregate(countPipeline);
    const totalData = totalResult[0]?.total ?? 0;

    // Tambahkan pagination
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
      isNext,
      nextChatId: chatsCurrently[chatsCurrently.length - 1]?.chatId ?? null,
    });
  } catch (error) {
    next(error);
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
