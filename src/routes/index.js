"use strict";

const router = require("express").Router();

const users = require("./users");
const registerVerify = require("./registerVerify");
const chatRoom = require("./chatRoom");
const chats = require("./chats");
const tools = require("./tools");
const category = require("./category");
const brand = require("./brand");
const shoes = require("./shoes");

router.use("/users", users);
router.use("/register-verify", registerVerify);
router.use("/chat-room", chatRoom);
router.use("/chats", chats);
router.use("/tools", tools);
router.use("/categories", category);
router.use("/brand", brand);
router.use("/shoes", shoes);

module.exports = router;
