'use strict'

const router = require('express').Router()

const users = require('./users')
const registerVerify = require('./registerVerify')
const chatRoom = require('./chatRoom')

router.use('/users', users)
router.use('/register-verify', registerVerify)
router.use('/chat-room', chatRoom)

module.exports = router