const router = require('express').Router()

const {
    postToken,
    verification
} = require('../controllers/registerVerify')

router.post('/add-verify-register', postToken)
router.post('/verification', verification)

module.exports = router