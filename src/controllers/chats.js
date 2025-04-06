const { HTTP_STATUS_CODE } = require('../constant');
const chats = require('../models/chats')

exports.getChats = async(req, res)=>{
    if (!userId || !userId.trim()) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'userId required'
        })
        return
    }
    
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      
      const { userId } = req.query;

      let buffer = [];
    
      try {
        const cursor = chats
          .find(
            { 
                userIds: { $in: [userId] },
                latestMessage: { $exists: true }
            }
        )
          .sort({latestMessageTimestamp: -1})
          .batchSize(40)
          .cursor();
    
          for await (const doc of cursor) {
            buffer.push(doc);
        
            if (buffer.length >= 50) {
              res.write(`data: ${JSON.stringify(buffer)}\n\n`);
              buffer = [];
              await new Promise((resolve) => setTimeout(resolve, 1000));
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
        console.error('Error streaming:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Internal Error' })}\n\n`);
        res.end();
      }
}

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