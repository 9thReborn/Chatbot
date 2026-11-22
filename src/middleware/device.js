"use strict";
const crypto = require("node:crypto");

function ensureDevice(req, _res, next) {
  if (!req.session.deviceId) req.session.deviceId = crypto.randomUUID();
  next();
}

module.exports = { ensureDevice };