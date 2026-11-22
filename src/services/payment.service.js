"use strict";

const { formatNaira } = require("../config/menu");

function createPaymentService({ paystack, orderService, appUrl }) {
    function guestEmail(deviceId) {
      return `guest-${deviceId.slice(0, 8)}@guests.restaurant-chatbot.test`;
    }

    async function startPayment(order) {
      if (order.payment?.authorizationUrl)
        return order.payment.authorizationUrl;

      const reference = `chop_${order._id}_${Date.now()}`;
      const data = await paystack.initializeTransaction({
        email: guestEmail(order.deviceId),
        amount: order.total,
        reference,
        callbackUrl: `${appUrl}/api/payments/callback`,
        metadata: { orderId: String(order._id) },
      });

      const saved = await orderService.savePaymentInit(order._id, {
        reference,
        authorizationUrl: data.authorization_url,
      });
      return saved.payment.authorizationUrl;
    }

    async function confirmPayment(reference) {
      const order = await orderService.findByReference(reference);
      if (!order) return { ok: false, reason: "unknown_reference" };
      if (order.paymentStatus === "paid")
        return { ok: true, order, alreadyPaid: true };

      const transaction = await paystack.verifyTransaction(reference);
      if (transaction.status !== "success")
        return { ok: false, reason: transaction.status, order };
      if (
        transaction.amount !== order.total ||
        transaction.currency !== "NGN"
      ) {
        return { ok: false, reason: "amount_mismatch", order };
      }

      const updated = await orderService.markPaid(order._id);
      // updated === null means a parallel call (webhook vs callback) got there first. Still a success.
      return {
        ok: true,
        order: updated ?? { ...order, paymentStatus: "paid" },
      };
    }

    function successNotice(order) {
      const ref = String(order._id).slice(-6).toUpperCase();
      return `Payment successful 🎉\nOrder #${ref} (${formatNaira(order.total)}) has been paid. Thank you!`;
    }

    return {
      startPayment,
      confirmPayment,
      successNotice,
      isValidWebhookSignature: paystack.isValidWebhookSignature,
    };
}

module.exports = { createPaymentService };