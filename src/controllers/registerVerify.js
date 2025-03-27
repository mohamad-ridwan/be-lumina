const registerVerify = require('../models/registerVerify')
const users = require('../models/users')
const jwt = require('jsonwebtoken')
const { HTTP_STATUS_CODE } = require('../constant');
const { generateTokenClient } = require('../helpers/generateToken');
const { errorMessage } = require('../utils/errorMessage');

function pushPostToken(token, userId, res, next) {
    const post = new registerVerify({
        token: token,
        userId,
        tokenClient: generateTokenClient()
    });

    post
        .save()
        .then((result) => {
            res.status(201).json({
                message: 'successfully added verification',
                data: result,
            });
        })
        .catch((err) => {
            console.log('err-post', err)
            next(err)
        });
}

exports.verification = async (req, res, next) => {
    const { tokenClient, token } = req.body

    let err = {}
    if (!tokenClient || !tokenClient.trim()) {
        err.tokenClient = 'tokenClient required!'
    } else if (!token || !token.trim()) {
        err.token = 'token required!'
    }

    if (Object.keys(err).length > 0) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: Object.entries(err).map(p => p[1])[0]
        })
    }

    const tokenCurrently = await registerVerify.findOne({ tokenClient, token })

    if (!tokenCurrently) {
        res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
            message: 'Token is invalid or expired.'
        })
    }

    jwt.verify(token, process.env.TOKEN_BEARER_SECRET, async (err, data) => {
        if (err) {
            res.status(HTTP_STATUS_CODE.NOT_FOUND).json({
                message: 'Token is invalid or expired.',
                errJwt: err
            })
        } else {
            const resultDeleteToken = await registerVerify.deleteOne({ token })
            if (!resultDeleteToken) {
                res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
                    message: errorMessage.serverError
                })
            }

            const resultUserUpdate = await users.updateOne(
                { id: tokenCurrently?.userId, },
                { $set: { verification: true } }
            )

            if(!resultUserUpdate){
                res.status(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR).json({
                    message: errorMessage.serverError
                })
            }

            res.status(HTTP_STATUS_CODE.OK).json({
                message: 'Successfully verified'
            })
        }
    })
}

exports.postToken = (req, res, next) => {
    const { userId } = req.query

    if (!userId) {
        res.status(HTTP_STATUS_CODE.BAD_REQUEST).json({
            message: 'user id required'
        })
    }
    jwt.sign({
        userId
    },
        process.env.TOKEN_BEARER_SECRET,
        { expiresIn: '1h' },
        (err, token) => {
            if (err) {
                next(err)
            } else {
                pushPostToken(token, userId, res, next)
            }
        }
    )
}