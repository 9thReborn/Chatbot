"use strict";

const path = require("node:path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const { createChatController } = require("./controllers/chat.controller");
const { createPaymentController } = require("./controllers/payment.controller");
const { createChatRouter } = require("./routes/chat.routes");
const { notFound, errorHandler } = require("./middleware/errors");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function createApp({
  chatbot,
  paymentService,
  sessionSecret,
  sessionStore,
  isProduction = false,
}) {
  const app = express();

  // On Render (and most hosts) a proxy terminates HTTPS in front of us.
  // Without this, Express thinks the request was plain HTTP and refuses to
  // set our `secure` cookie.
  app.set("trust proxy", 1);

  app.use(helmet()); // sensible security headers, incl. a Content-Security-Policy

  // Static files first: the CSS/JS don't need a session, so they skip that work.
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 60, // 60 messages a minute per IP is plenty for a human
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: {
        messages: [
          {
            text: "You're sending messages too quickly. Please wait a moment.",
          },
        ],
      },
    }),
  );

  const payments = createPaymentController(paymentService);

  // The webhook needs the RAW body to check Paystack's signature, so it is
  // registered BEFORE express.json() and gets its own raw parser. It also
  // needs no session (Paystack's server has no cookie).
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json", limit: "100kb" }),
    payments.webhook,
  );

  // A chat reply is a few characters; a tiny limit stops huge-body abuse.
  app.use(express.json({ limit: "1kb" }));

  app.use(
    session({
      name: "chatbot.sid",
      secret: sessionSecret, // signs the cookie so it can't be forged
      store: sessionStore, // MongoDB in production; memory in tests
      resave: false, // don't rewrite unchanged sessions on every request
      saveUninitialized: false, // don't store empty sessions for every bot/crawler
      rolling: true, // each visit pushes expiry forward: 30 days since LAST visit
      cookie: {
        httpOnly: true, 
        sameSite: "lax",
        secure: isProduction, // HTTPS-only in production
        maxAge: THIRTY_DAYS_MS,
      },
    }),
  );

  app.use("/api/chat", createChatRouter(createChatController(chatbot)));
  app.get("/api/payments/callback", payments.callback);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
