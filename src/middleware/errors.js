"use strict";

function notFound(_req, res) {
  res.status(404).json({ messages: [{ text: "Not found." }] });
}

function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("[error]", err);

  const text =
    status >= 500
      ? "Sorry, something went wrong on our side. Please try again."
      : "That request was not valid. Please reply with one of the numbers shown.";
  res.status(status).json({ messages: [{ text }] });
}

module.exports = { notFound, errorHandler };