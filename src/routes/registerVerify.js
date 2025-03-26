const router = require('express').Router()

const {
    postToken,
} = require('../controllers/registerVerify')

router.post('/add-verify-register', postToken)

module.exports = router