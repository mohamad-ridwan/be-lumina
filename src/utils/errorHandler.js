"use strict";

const { HTTP_STATUS_CODE } = require("../constant");

module.exports = ({ code, error }, req, res, next) => {
  const status = error?.errorStatus || 500;
  const message = error?.message;
  const data = error?.data;
  res.status(status).json({ message: message, data: data })
};