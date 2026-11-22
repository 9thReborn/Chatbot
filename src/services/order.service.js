"use strict";

const Order = require("../models/order.model");

const orderService = {
  async createFromCart(deviceId, cart, { scheduledFor } = {}) {
    const items = cart.map(({ name, option, unitPrice, quantity }) => ({
      name,
      option,
      unitPrice,
      quantity,
    }));
    const total = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );

    return Order.create({
      deviceId,
      items,
      total,
      status: scheduledFor ? "scheduled" : "placed",
      scheduledFor,
    });
  },

  listForDevice(deviceId, limit = 20) {
    return Order.find({ deviceId }).sort({ createdAt: -1 }).limit(limit).lean();
  },

  latestUnpaid(deviceId) {
    return Order.findOne({ deviceId, paymentStatus: "unpaid" })
      .sort({ createdAt: -1 })
      .lean();
  },

  findByReference(reference) {
    return Order.findOne({ "payment.reference": reference }).lean();
  },

  async savePaymentInit(orderId, { reference, authorizationUrl }) {
    const updated = await Order.findOneAndUpdate(
      { _id: orderId, "payment.reference": { $exists: false } },
      {
        $set: {
          "payment.reference": reference,
          "payment.authorizationUrl": authorizationUrl,
        },
      },
      { returnDocument: "after" },
    ).lean();
    return updated ?? Order.findById(orderId).lean();
  },

  markPaid(orderId) {
    return Order.findOneAndUpdate(
      { _id: orderId, paymentStatus: "unpaid" },
      { $set: { paymentStatus: "paid", "payment.paidAt": new Date() } },
      { returnDocument: "after" },
    ).lean();
  },

  /** Used by the scheduler: move every due scheduled order to "placed". */
  async releaseDueScheduledOrders(now = new Date()) {
    const result = await Order.updateMany(
      { status: "scheduled", scheduledFor: { $lte: now } },
      { $set: { status: "placed" } },
    );
    return result.modifiedCount;
  },
};

module.exports = orderService;