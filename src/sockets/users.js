const users = require('../models/users')

async function userProfile(data, io){
    const userCurrently = await users.findOne({id: data.profileId})

    if(!userCurrently){
        return
    }

    io.emit('user-profile', {
        senderId: data.senderId,
        profile: userCurrently,
        profileIdConnection: data.profileIdConnection,
        actionType: data.actionType
    })
}

const usersSocket = {
    userProfile
}

module.exports = { usersSocket }