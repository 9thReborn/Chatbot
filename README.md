# Chatbot

A chat-style ordering bot. Customers reply with numbers to build an order, check out, look at their order history, schedule an order for later and pay with **Paystack (test mode)**. There are no accounts: each **device (browser)** gets its own session.

Stack: Node.js 20+, Express 5, MongoDB/Mongoose, express-session + connect-mongo, Paystack REST API, vanilla HTML/CSS/JS.

**Paying in test mode:** send `95` after placing an order, tap the button, and use one of the test cards on Paystack's [Test Payments](https://paystack.com/docs/payments/test-payments/) page. No real money moves.

## The conversation

| Reply | What happens |
|---|---|
| `1` | Shows the menu. Then reply with an item number. Items that have options (size, protein, drink type) ask you to pick one. |
| `99` | Checks out the current order. If there isn't one, you get "No order to place". Either way you're offered a new order. |
| `98` | Order history for this device, newest first, with paid/unpaid status. |
| `97` | The current (not yet placed) order and its total. |
| `96` | *(optional feature)* Schedules the current order for 30 min, 1 h, 2 h or 4 h from now. |
| `95` | Gives you a Paystack payment link for your latest unpaid order. |
| `0` | Cancels the current order, if there is one. |

`99`, `98`, `97`, `96`, `95` and `0` work at **any** point in the conversation. Menu and option numbers stay between 1 and 9, so they never clash with these.


## Project layout

```
src/
  server.js                 composition root: connect DB, wire dependencies, listen
  app.js                    Express app & middleware order (no DB, no listen → testable)
  config/env.js             reads env vars once, fails fast if any are missing
  config/menu.js            the menu (prices in kobo)
  models/order.model.js     Order schema
  services/
    chatbot.service.js      the conversation state machine (pure logic)
    order.service.js        all Order database access
    payment.service.js      payment rules: when to charge, what counts as paid
    paystack.client.js      thin HTTP wrapper around Paystack's API
  controllers/              HTTP ⇄ services, kept thin
  routes/chat.routes.js
  middleware/               device id, input validation, errors
  jobs/scheduler.js         turns due scheduled orders into placed orders
public/                     chat UI (index.html, app.js, styles.css)
tests/                      Jest + Supertest, using in-memory fakes
```

This project uses the same Router → Controller → Service → Model layering. One addition: services get their dependencies passed in (`createChatbot({ orderService, paymentService })`) instead of `require`-ing them. That's what lets the tests replace MongoDB and Paystack with fakes.

## Key design decisions and why

### 1. Plain HTTP (REST), not Socket.IO
Here every exchange is **request → reply**: the customer sends a number and the bot answers it. The server never needs to speak first. Paystack's "payment successful" arrives by redirecting the browser, so it doesn't need a push either.
Socket.IO would add a long-lived connection, reconnection handling and sticky sessions on multi-instance hosts, and none of it would buy us anything. If we later wanted the server to speak first (say, "your scheduled order is now being prepared"), that's when Socket.IO, or the simpler one-way Server-Sent Events, would earn its place. The chatbot service doesn't know about HTTP, so it could be moved behind a socket without changes.

### 2. "Sessions based on devices" = a cookie + a server-side session in MongoDB

- `express-session` gives each browser a signed, `httpOnly` cookie holding a random id. The data itself (conversation state and cart) lives server-side, in MongoDB via `connect-mongo`. That way it survives restarts and deploys.
- We store our own `deviceId` (a UUID) inside the session and tie orders to it instead of to `req.sessionID`. Session ids are meant to be replaceable (for example, regenerated at login), and the device's identity shouldn't depend on that.
- The cookie has `sameSite: 'lax'`. Returning from Paystack is a cross-site navigation, and `'strict'` would drop the cookie on it, so the customer would come back to an empty session.
- **Trade-off:** clearing cookies or switching browsers means a new "device" and an empty history. That's the price of not having accounts. Storing an id in `localStorage` has the same limitation, and page JavaScript can read it, which is less safe.

### 3. Cart in the session, placed orders in an `orders` collection

The cart is short-lived, belongs to one conversation and is changed on almost every message, so it lives in the session. A placed order has to be durable and queryable (history, payments, scheduler), so it becomes a document. Order lines **snapshot** name and price, so a future menu change can't rewrite old receipts.

### 4. Two-layer validation

`middleware/validate.js` rejects anything that isn't 1–3 digits. That covers text, objects like `{"$gt": ""}`, huge strings and missing fields. The chatbot then checks whether the number makes sense *in the current state*. Prices and totals are only ever computed on the server from our own menu, because the browser only sends a number.

### 5. Money as integer kobo

There are no floating-point rounding errors, and it's exactly what Paystack expects.

### 6. Payments: never trust the redirect

1. `95` → `initializeTransaction` (amount, callback URL, `orderId` in metadata) → we store the reference and return Paystack's checkout URL. If you send `95` again for the same order, you get the same link back instead of a second transaction.
2. After paying, Paystack sends the **browser** to `/api/payments/callback?reference=…`. Anyone could type that URL, so we **verify with Paystack's API** using our secret key and check that `amount` and `currency` match the order. Only then do we mark it paid, leave a one-time notice in the session and redirect to `/`. The chat shows "Payment successful".
3. **Webhook** (`POST /api/payments/webhook`): Paystack's **servers** also notify us. This is the safety net for a customer who closes the tab before the redirect. We check the HMAC-SHA512 `x-paystack-signature` against the raw body.
4. The callback and webhook can arrive at the same moment, so "mark paid" is a **conditional atomic update** (`paymentStatus: 'unpaid'` in the filter). It runs once, whichever arrives first.

The callback works on `localhost` because the redirect happens in your browser.

**Email trade-off:** Paystack requires an email for every transaction and we have no accounts. So we generate a placeholder per device. That keeps the chat short, but customers don't get Paystack's email receipt. Adding a "what's your email?" step is a good extension.

### 7. Scheduling: poll the database, don't `setTimeout`

A per-order `setTimeout` lives only in memory and vanishes on every restart or deploy. Instead, every 30 seconds the server runs a single `updateMany` that moves due `scheduled` orders to `placed`. Running it twice is harmless, so it stays correct even with two instances. Outgrow it when due jobs need retries or side effects (SMS, a kitchen API). At that point, use a job queue such as BullMQ or Agenda.

## Deploying on Render

- Build command `npm install`, start command `npm start`.
- Environment: `NODE_ENV=production`, `MONGODB_URI` (Atlas), `SESSION_SECRET`, `PAYSTACK_SECRET_KEY`, `APP_URL=https://<your-app>.onrender.com`.
- In the Paystack dashboard (test mode), set the webhook URL as described above.
- `app.set('trust proxy', 1)` is already set, so `secure` cookies work behind Render's HTTPS proxy.

## Ideas to extend

- Ask for an email before paying (receipts), validated with `isEmail()`.
- Let `0` also cancel an **unpaid scheduled** order.
- Move the menu into MongoDB with a small admin API.
- Push "your scheduled order is being prepared" with Server-Sent Events.