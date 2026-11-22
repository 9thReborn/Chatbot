"use strict";

const crypto = require("node:crypto");
const { createPaymentService } = require("../src/services/payment.service");
const { createPaystackClient } = require("../src/services/paystack.client");
const {
  createFakeOrderService,
  createFakePaystack,
} = require("./helpers/fakes");

async function placedOrder(orderService) {
  return orderService.createFromCart("device-1", [
    { name: "Jollof Rice", option: "Large", unitPrice: 350000, quantity: 2 },
  ]);
}

describe("payment service", () => {
  test("startPayment sends the order total in kobo with a callback URL, and reuses the link", async () => {
    const orderService = createFakeOrderService();
    const paystack = createFakePaystack();
    const payments = createPaymentService({
      paystack,
      orderService,
      appUrl: "https://food.example",
    });
    const order = await placedOrder(orderService);

    const url1 = await payments.startPayment(order);
    const url2 = await payments.startPayment(order);

    expect(url1).toBe(url2);
    expect(paystack.calls.initialize).toHaveLength(1);
    expect(paystack.calls.initialize[0]).toMatchObject({
      amount: 700000,
      callbackUrl: "https://food.example/api/payments/callback",
      metadata: { orderId: order._id },
    });
  });

  test("confirmPayment marks the order paid only when Paystack says success with the right amount", async () => {
    const orderService = createFakeOrderService();
    const paystack = createFakePaystack({
      verifyResult: { status: "success", amount: 700000, currency: "NGN" },
    });
    const payments = createPaymentService({
      paystack,
      orderService,
      appUrl: "https://food.example",
    });
    const order = await placedOrder(orderService);
    await payments.startPayment(order);

    const result = await payments.confirmPayment(order.payment.reference);
    expect(result.ok).toBe(true);
    expect(order.paymentStatus).toBe("paid");

    // Second confirmation (e.g. webhook after callback) is a harmless no-op.
    const again = await payments.confirmPayment(order.payment.reference);
    expect(again).toMatchObject({ ok: true, alreadyPaid: true });
    expect(paystack.calls.verify).toHaveLength(1);
  });

  test("rejects an amount mismatch, a failed payment and an unknown reference", async () => {
    const orderService = createFakeOrderService();
    const paystack = createFakePaystack({
      verifyResult: { status: "success", amount: 100, currency: "NGN" },
    });
    const payments = createPaymentService({
      paystack,
      orderService,
      appUrl: "https://food.example",
    });
    const order = await placedOrder(orderService);
    await payments.startPayment(order);

    expect(
      await payments.confirmPayment(order.payment.reference),
    ).toMatchObject({ ok: false, reason: "amount_mismatch" });

    paystack.calls.verify.length = 0;
    const failing = createPaymentService({
      paystack: createFakePaystack({ verifyResult: { status: "failed" } }),
      orderService,
      appUrl: "x",
    });
    expect(await failing.confirmPayment(order.payment.reference)).toMatchObject(
      { ok: false, reason: "failed" },
    );

    expect(await payments.confirmPayment("chop_nope")).toMatchObject({
      ok: false,
      reason: "unknown_reference",
    });
    expect(order.paymentStatus).toBe("unpaid");
  });
    
    test("the guest email uses a real top-level domain (Paystack rejects .test, .local, etc.)", async () => {
      const orderService = createFakeOrderService();
      const paystack = createFakePaystack();
      const payments = createPaymentService({
        paystack,
        orderService,
        appUrl: "https://food.example",
      });
      await payments.startPayment(await placedOrder(orderService));

      const { email } = paystack.calls.initialize[0];
      expect(email).toMatch(/^[^@\s]+@[^@\s]+\.(com|ng|org|net)$/);
    });
});

describe("Paystack webhook signature", () => {
  const secretKey = "sk_test_dummy";
  const client = createPaystackClient({
    secretKey,
    fetchImpl: async () => {
      throw new Error("no network in tests");
    },
  });
  const body = Buffer.from(
    JSON.stringify({ event: "charge.success", data: { reference: "chop_1" } }),
  );
  const sign = (buf, key = secretKey) =>
    crypto.createHmac("sha512", key).update(buf).digest("hex");

  test("accepts a correctly signed body", () => {
    expect(client.isValidWebhookSignature(body, sign(body))).toBe(true);
  });

  test("rejects a missing, wrong-key or tampered signature", () => {
    expect(client.isValidWebhookSignature(body, undefined)).toBe(false);
    expect(
      client.isValidWebhookSignature(body, sign(body, "sk_test_attacker")),
    ).toBe(false);
    const tampered = Buffer.from(body.toString().replace("chop_1", "chop_2"));
    expect(client.isValidWebhookSignature(tampered, sign(body))).toBe(false);
  });
});
