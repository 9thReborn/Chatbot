"use strict";

require("dotenv").config({ quiet: true });

function loadConfig(env = process.env) {
  const required = [
    "MONGODB_URI",
    "SESSION_SECRET",
    "PAYSTACK_SECRET_KEY",
    "APP_URL",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  if (!env.PAYSTACK_SECRET_KEY.startsWith("sk_test_")) {
    // This project is meant to run against a Paystack TEST account only.
    console.warn(
      "[config] PAYSTACK_SECRET_KEY does not look like a test key (sk_test_...).",
    );
  }
  return Object.freeze({
    port: Number(env.PORT) || 3000,
    mongoUri: env.MONGODB_URI,
    sessionSecret: env.SESSION_SECRET,
    paystackSecretKey: env.PAYSTACK_SECRET_KEY,
    // Public base URL of this app, used to build Paystack's callback_url.
    appUrl: env.APP_URL.replace(/\/+$/, ""),
    isProduction: env.NODE_ENV === "production",
  });
}

module.exports = { loadConfig };
