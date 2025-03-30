const users = require('../models/users')

async function userProfile(data, io){
    const userCurrently = await users.findOne({id: data.profileId})

    if(!userCurrently){
        return
    }

    io.emit('user-profile', {
        senderId: data.senderId,
        profile: userCurrently
    })
}

const usersSocket = {
    userProfile
}

module.exports = { usersSocket }