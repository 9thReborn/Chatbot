"use strict";

const { Router } = require("express");
const { ensureDevice } = require("../middleware/device");
const { validateChatMessage } = require("../middleware/validate");

function createChatRouter(controller) {
  const router = Router();
  router.use(ensureDevice);
  router.get("/welcome", controller.welcome);
  router.post("/message", validateChatMessage, controller.message);
  return router;
}

module.exports = { createChatRouter };
