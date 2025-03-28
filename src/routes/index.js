'use strict'

const router = require('express').Router()

const users = require('./users')
const registerVerify = require('./registerVerify')
const chatRoom = require('./chatRoom')
const chats = require('./chats')

router.use('/users', users)
router.use('/register-verify', registerVerify)
router.use('/chat-room', chatRoom)
router.use('/chats', chats)

module.exports = router