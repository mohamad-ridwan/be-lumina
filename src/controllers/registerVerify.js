const registerVerify = require('../models/registerVerify')
const jwt = require('jsonwebtoken')
const { HTTP_STATUS_CODE } = require('../constant');
const { generateTokenClient } = require('../helpers/generateToken');

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