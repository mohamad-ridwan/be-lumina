const router = require('express').Router()

const {
    getChatRoom,
    stream
    // getBatchChatRoom
} = require('../controllers/chatRoom')

router.post('/', getChatRoom)
router.get('/stream', stream)
// router.post('/batch', getBatchChatRoom)

module.exports = router