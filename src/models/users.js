const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const users = new Schema(
    {
        verification: {
            type: Boolean
        },
        username: {
            type: String,
        },
        email: {
            type: String
        },
        password: {
            type: String
        },
        image: {
            type: String
        },
        id: {
            type: String,
        },
        phoneNumber:{
            type: String
        }
    },
    {
        timestamp: true,
    }
);

module.exports = mongoose.model("users", users);
