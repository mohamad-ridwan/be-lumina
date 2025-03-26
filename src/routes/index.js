'use strict'

const router = require('express').Router()

const users = require('./users')
const registerVerify = require('./registerVerify')

router.use('/users', users)
router.use('/register-verify', registerVerify)

module.exports = router