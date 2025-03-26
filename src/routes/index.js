'use strict'

const router = require('express').Router()

const users = require('./users')

router.use('/users', users)

module.exports = router