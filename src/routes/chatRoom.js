const router = require('express').Router()

const {
    getChatRoom,
    stream,
    getMessagesPagination
    // getBatchChatRoom
} = require('../controllers/chatRoom')

router.post('/', getChatRoom)
router.get('/stream', stream)
router.get('/messages', getMessagesPagination)
// router.post('/batch', getBatchChatRoom)

module.exports = router