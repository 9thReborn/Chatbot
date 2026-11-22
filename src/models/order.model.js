"use strict";

const { Schema, model } = require("mongoose");

const orderItemSchema = new Schema(
  {
    name: { type: String, required: true },
    option: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 }, // kobo
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    // The device id stored in the session is the "owner".
    deviceId: { type: String, required: true },

    items: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => items.length > 0,
        message: "An order needs at least one item",
      },
    },
    total: { type: Number, required: true, min: 1 }, // kobo

    status: { type: String, enum: ["scheduled", "placed"], default: "placed" },
    scheduledFor: { type: Date },

    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
    },
    payment: {
      reference: { type: String },
      authorizationUrl: { type: String },
      paidAt: { type: Date },
    },
  },
  { timestamps: true },
);

// Indexes match the queries we actually run (see order.service.js):
orderSchema.index({ deviceId: 1, createdAt: -1 }); // history + latest unpaid
orderSchema.index({ status: 1, scheduledFor: 1 }); // scheduler's "what's due?" query
orderSchema.index(
  { 'payment.reference': 1 },
  // Unique, but only for orders that actually have a reference yet.
  { unique: true, partialFilterExpression: { 'payment.reference': { $type: 'string' } } },
);

module.exports = model('Order', orderSchema);