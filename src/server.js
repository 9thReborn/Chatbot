"use strict";

const mongoose = require("mongoose");
const { MongoStore } = require("connect-mongo");

const { loadConfig } = require("./config/env");
const { createApp } = require("./app");
const orderService = require("./services/order.service");
const { createChatbot } = require("./services/chatbot.service");
const { createPaystackClient } = require("./services/paystack.client");
const { createPaymentService } = require("./services/payment.service");
const { startScheduler } = require("./jobs/scheduler");


async function main() {
  const config = loadConfig();

  await mongoose.connect(config.mongoUri);
  console.log("[db] connected");

 
  const sessionStore = MongoStore.create({
    mongoUrl: config.mongoUri,
    collectionName: "sessions",
    ttl: 30 * 24 * 60 * 60, // seconds; 
  });

  const paystack = createPaystackClient({
    secretKey: config.paystackSecretKey,
  });
  const paymentService = createPaymentService({
    paystack,
    orderService,
    appUrl: config.appUrl,
  });
  const chatbot = createChatbot({ orderService, paymentService });

  const app = createApp({
    chatbot,
    paymentService,
    sessionSecret: config.sessionSecret,
    sessionStore,
    isProduction: config.isProduction,
  });

  const stopScheduler = startScheduler({ orderService });
  const server = app.listen(config.port, () =>
    console.log(`[http] listening on http://localhost:${config.port}`),
  );

  // Graceful shutdown: finish in-flight requests, then close DB connections.
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    stopScheduler();
    server.close(async () => {
      await Promise.allSettled([mongoose.disconnect(), sessionStore.close()]);
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[server] failed to start:", err.message);
  process.exit(1);
});
