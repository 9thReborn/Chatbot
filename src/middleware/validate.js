"use strict";

const { body, validationResult } = require("express-validator");

const validateChatMessage = [
  body("message")
    .exists({ values: "null" })
    .withMessage("message is required")
    .bail()
    .isString()
    .withMessage("message must be text")
    .bail()
    .trim()
    .matches(/^\d{1,3}$/)
    .withMessage("Please reply with one of the numbers shown, e.g. 1, 97 or 0.")
    // Normalise "007" -> "7" so the bot only ever sees canonical numbers.
    .customSanitizer((value) => String(Number(value))),

  (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    // 400 is the correct HTTP status, but we shape the body like a normal chat
    // reply so the UI can just show it as a bot message.
    const [first] = result.array();
    return res.status(400).json({ messages: [{ text: first.msg }] });
  },
];

module.exports = { validateChatMessage };