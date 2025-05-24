const { HTTP_STATUS_CODE } = require("../constant");
const chats = require("../models/chats");

exports.getChatsPagination = async (req, res, next) => {
  try {
    const { userId, page = 1, limit = 20 } = req.query;

    if (!userId || !userId.trim()) {
      return res.status(400).json({ message: "userId required" });
    }

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const pipeline = [
      {
        $match: {
          userIds: { $in: [userId] },
          latestMessage: { $exists: true, $ne: [] },
        },
      },
      {
        // Tambahkan field 'latestUserMessageTimestamp' dari latestMessage yg match userId
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
            // atau gunakan $toDate jika field tersebut format ISO
          },
        },
      },
      {
        $sort: {
          latestUserMessageTimestamp: -1,
        },
      },
      {
        $skip: skip,
      },
      {
        $limit: limitNumber,
      },
    ];

    const chatsCurrently = await chats.aggregate(pipeline);

    const total = await chats.countDocuments({
      userIds: { $in: [userId] },
      latestMessage: { $exists: true, $ne: [] },
    });

    const totalPage = Math.ceil(total / limitNumber);

    return res.status(200).json({
      message: "Chats Data",
      data: chatsCurrently,
      page: pageNumber,
      limit: limitNumber,
      totalPage,
      totalData: total,
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
