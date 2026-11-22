"use strict";

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function createPaymentController(paymentService) {
  function redirectWithNotice(req, res, notice, outcome) {
    req.session.notice = notice;
    req.session.save(() => res.redirect(`/?payment=${outcome}`));
  }
  return {
    async callback(req, res) {
      const reference =
        typeof req.query.reference === "string" ? req.query.reference : "";
      if (!REFERENCE_PATTERN.test(reference)) {
        return redirectWithNotice(
          req,
          res,
          "We couldn't find that payment. Select 95 to try again.",
          "failed",
        );
      }

      try {
        const result = await paymentService.confirmPayment(reference);
        if (result.ok) {
          return redirectWithNotice(
            req,
            res,
            paymentService.successNotice(result.order),
            "success",
          );
        }
        return redirectWithNotice(
          req,
          res,
          "Your payment was not completed. Select 95 to try again.",
          "failed",
        );
      } catch (err) {
        console.error("[payments] callback verification failed:", err.message);
        return redirectWithNotice(
          req,
          res,
          "We couldn't confirm your payment yet. If you were charged, it will show as Paid in your order history (98) shortly.",
          "pending",
        );
      }
    },

    async webhook(req, res) {
      const signature = req.get("x-paystack-signature");
      if (!paymentService.isValidWebhookSignature(req.body, signature))
        return res.sendStatus(401);

      let event;
      try {
        event = JSON.parse(req.body.toString("utf8"));
      } catch {
        return res.sendStatus(400);
      }

      // Acknowledge quickly; Paystack retries webhooks that don't get a fast 200.
        res.sendStatus(200);
        console.log(
          `[payments] webhook received: ${event.event} ${event.data?.reference ?? ""}`,
        );

      if (
        event.event === "charge.success" &&
        typeof event.data?.reference === "string"
      ) {
        paymentService
          .confirmPayment(event.data.reference)
          .catch((err) =>
            console.error(
              "[payments] webhook confirmation failed:",
              err.message,
            ),
          );
      }
    },
  };
}

module.exports = { createPaymentController };
