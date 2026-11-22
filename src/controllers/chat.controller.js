"use strict";

function createChatController(chatbot) {
  return {
    async welcome(req, res) {
      const messages = await chatbot.welcome(req.session);
      res.json({ messages });
    },

    async message(req, res) {
      const messages = await chatbot.handle(req.session, req.body.message);
      res.json({ messages });
    },
  };
}

module.exports = { createChatController };
