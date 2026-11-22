"use strict";

const request = require("supertest");
const { createApp } = require("../src/app");
const { createChatbot } = require("../src/services/chatbot.service");
const { createPaymentService } = require("../src/services/payment.service");
const {
  createFakeOrderService,
  createFakePaystack,
} = require("./helpers/fakes");

/**
 * HTTP-level tests: the real Express app, real express-session (with its
 * default in-memory store), real validation — only the database and Paystack
 * are faked. `request.agent(app)` keeps cookies between requests, exactly like
 * one browser/device would.
 */
function buildApp(
  verifyResult = { status: "success", amount: 400000, currency: "NGN" },
) {
  const orderService = createFakeOrderService();
  const paystack = createFakePaystack({ verifyResult });
  const paymentService = createPaymentService({
    paystack,
    orderService,
    appUrl: "http://localhost:3000",
  });
  const chatbot = createChatbot({ orderService, paymentService });
  const app = createApp({
    chatbot,
    paymentService,
    sessionSecret: "test-secret",
  });
  return { app, orderService };
}

const send = (agent, message) =>
  agent.post("/api/chat/message").send({ message });
const allText = (res) => res.body.messages.map((m) => m.text).join("\n");

describe("HTTP API", () => {
  test("rejects input that is not a short number with 400 and a chat-shaped message", async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    for (const bad of ["hello", "1; DROP", "12345", "", "<script>"]) {
      const res = await send(agent, bad);
      expect(res.status).toBe(400);
      expect(allText(res)).toMatch(/numbers shown/);
    }
    expect((await agent.post("/api/chat/message").send({})).status).toBe(400);
    expect(
      (await agent.post("/api/chat/message").send({ message: { $gt: "" } }))
        .status,
    ).toBe(400);
  });

  test("the session cookie is httpOnly and SameSite=Lax", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/chat/welcome");
    const cookie = res.headers["set-cookie"][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  test("each device (cookie jar) has its own cart and history", async () => {
    const { app } = buildApp();
    const phone = request.agent(app);
    const laptop = request.agent(app);

    await phone.get("/api/chat/welcome");
    await laptop.get("/api/chat/welcome");

    await send(phone, "1");
    await send(phone, "5");
    expect(allText(await send(phone, "99"))).toContain("Order placed");

    expect(allText(await send(laptop, "98"))).toContain("no placed orders");
    expect(allText(await send(phone, "98"))).toContain("Small Chops Platter");
  });

  test("full payment loop: pay link -> Paystack callback -> success notice back in the chat", async () => {
    const { app, orderService } = buildApp();
    const device = request.agent(app);
    await device.get("/api/chat/welcome");
    await send(device, "1");
    await send(device, "5");
    await send(device, "99");

    const payReply = await send(device, "95");
    expect(payReply.body.messages[0].link.url).toMatch(
      /^https:\/\/checkout\.paystack\.com\//,
    );

    const { reference } = orderService.orders[0].payment;
    const callback = await device.get(
      `/api/payments/callback?reference=${reference}&trxref=${reference}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("/?payment=success");

    expect(allText(await device.get("/api/chat/welcome"))).toContain(
      "Payment successful",
    );
    expect(orderService.orders[0].paymentStatus).toBe("paid");
    expect(allText(await send(device, "98"))).toContain("Paid ✅");
  });

  test("a callback with a junk reference does not mark anything paid", async () => {
    const { app, orderService } = buildApp();
    const res = await request(app).get(
      "/api/payments/callback?reference=../../etc",
    );
    expect(res.headers.location).toBe("/?payment=failed");
    expect(orderService.orders).toHaveLength(0);
  });
});
