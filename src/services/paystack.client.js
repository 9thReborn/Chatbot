"use strict";

const crypto = require("node:crypto");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function createPaystackClient({ secretKey, fetchImpl = globalThis.fetch }) {
  async function request(path, { method = "GET", body } = {}) {
    const res = await fetchImpl(`${PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`, // secret key: server-side only, never sent to the browser
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000), // never let a slow third party hang our request forever
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.status) {
      const error = new Error(
        `Paystack request failed: ${payload?.message ?? res.status}`,
      );
      error.status = 502; // "Bad Gateway": an upstream service failed, not our client
      throw error;
    }
    return payload.data;
  }

  return {
    /** amount is in kobo. Returns { authorization_url, access_code, reference }. */
    initializeTransaction({ email, amount, reference, callbackUrl, metadata }) {
      return request("/transaction/initialize", {
        method: "POST",
        body: {
          email,
          amount,
          reference,
          currency: "NGN",
          callback_url: callbackUrl,
          metadata,
        },
      });
    },

    /** Returns the transaction, including .status ('success', 'failed', 'abandoned'...), .amount, .currency. */
    verifyTransaction(reference) {
      return request(`/transaction/verify/${encodeURIComponent(reference)}`);
    },

    /**
     * Paystack signs every webhook: header x-paystack-signature is the
     * HMAC-SHA512 of the raw request body, keyed with your secret key.
     * Anyone can POST to our webhook URL, so without this check an attacker
     * could send a fake "charge.success" and get free food.
     *
     * timingSafeEqual compares in constant time, so an attacker can't learn
     * the correct signature byte-by-byte from how long the comparison takes.
     */
    isValidWebhookSignature(rawBody, signature) {
      if (typeof signature !== "string" || !Buffer.isBuffer(rawBody))
        return false;
      const expected = crypto
        .createHmac("sha512", secretKey)
        .update(rawBody)
        .digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}

module.exports = { createPaystackClient };