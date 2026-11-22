"use strict";

const crypto = require("node:crypto");

/**
 * An in-memory stand-in for order.service.js with the SAME function names.
 * Because the chatbot only depends on this interface (not on Mongoose),
 * tests run in milliseconds and never need a database.
 */
function createFakeOrderService() {
  const orders = [];
  let tick = 0;
  const fakeId = () => crypto.randomBytes(12).toString("hex");

  return {
    orders,
    async createFromCart(deviceId, cart, { scheduledFor } = {}) {
      const items = cart.map((l) => ({ ...l }));
      const order = {
        _id: fakeId(),
        deviceId,
        items,
        total: items.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
        status: scheduledFor ? "scheduled" : "placed",
        scheduledFor,
        paymentStatus: "unpaid",
        payment: {},
        createdAt: new Date(Date.now() + tick++), // strictly increasing for stable ordering
      };
      orders.push(order);
      return order;
    },
    async listForDevice(deviceId) {
      return orders
        .filter((o) => o.deviceId === deviceId)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async latestUnpaid(deviceId) {
      return (
        (await this.listForDevice(deviceId)).find(
          (o) => o.paymentStatus === "unpaid",
        ) ?? null
      );
    },
    async findByReference(reference) {
      return orders.find((o) => o.payment.reference === reference) ?? null;
    },
    async savePaymentInit(orderId, { reference, authorizationUrl }) {
      const order = orders.find((o) => o._id === orderId);
      if (!order.payment.reference)
        order.payment = { reference, authorizationUrl };
      return order;
    },
    async markPaid(orderId) {
      const order = orders.find(
        (o) => o._id === orderId && o.paymentStatus === "unpaid",
      );
      if (!order) return null;
      order.paymentStatus = "paid";
      return order;
    },
    async releaseDueScheduledOrders(now) {
      let n = 0;
      for (const o of orders)
        if (o.status === "scheduled" && o.scheduledFor <= now) {
          o.status = "placed";
          n++;
        }
      return n;
    },
  };
}

/** A fake Paystack client that records calls and lets each test decide what "verify" returns. */
function createFakePaystack({ verifyResult } = {}) {
  const calls = { initialize: [], verify: [] };
  return {
    calls,
    async initializeTransaction(args) {
      calls.initialize.push(args);
      return {
        authorization_url: `https://checkout.paystack.com/fake-${calls.initialize.length}`,
        reference: args.reference,
      };
    },
    async verifyTransaction(reference) {
      calls.verify.push(reference);
      return typeof verifyResult === "function"
        ? verifyResult(reference)
        : verifyResult;
    },
    isValidWebhookSignature: () => true,
  };
}

module.exports = { createFakeOrderService, createFakePaystack };
