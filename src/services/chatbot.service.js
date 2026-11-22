"use strict";

const { MENU, formatNaira } = require("../config/menu");

const STATES = Object.freeze({
  MAIN: "MAIN",
  SELECTING_ITEM: "SELECTING_ITEM",
  SELECTING_OPTION: "SELECTING_OPTION",
  SCHEDULING: "SCHEDULING",
});

// Guards so a session (stored in MongoDB) can't be grown without limit.
const LIMITS = Object.freeze({ maxCartLines: 10, maxQuantityPerLine: 20 });

// Relative times avoid time-zone bugs: "in 1 hour" means the same thing on a
// server running in UTC (e.g. Render) as it does for a customer in Lagos.
const SCHEDULE_CHOICES = Object.freeze([
  { label: 'In 30 minutes', minutes: 30 },
  { label: 'In 1 hour', minutes: 60 },
  { label: 'In 2 hours', minutes: 120 },
  { label: 'In 4 hours', minutes: 240 },
]);

const MAIN_MENU = [
  'Select 1 to Place an order',
  'Select 99 to checkout order',
  'Select 98 to see order history',
  'Select 97 to see current order',
  'Select 96 to schedule current order',
  'Select 95 to pay for your order',
  'Select 0 to cancel order',
].join('\n');

// ---------- small formatting helpers (pure functions, easy to test) ----------

const msg = (text, extra = {}) => ({ text, ...extra });
const shortRef = (order) => String(order._id).slice(-6).toUpperCase();
const formatTime = (date) =>
  new Date(date).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });

function itemsText() {
  const lines = MENU.map((item, i) => {
    const prices = item.options.map((o) => o.price);
    const price = prices.length === 1 ? formatNaira(prices[0]) : `from ${formatNaira(Math.min(...prices))}`;
    return `${i + 1}. ${item.name} — ${price}`;
  });
  return `Here's our menu. Reply with an item number:\n\n${lines.join('\n')}`;
}

function optionsText(item) {
  const lines = item.options.map((o, i) => `${i + 1}. ${o.name} — ${formatNaira(o.price)}`);
  return `${item.name} — which option would you like?\n\n${lines.join('\n')}`;
}

function linesText(items) {
  return items.map((l) => `${l.quantity} x ${l.name} (${l.option}) — ${formatNaira(l.unitPrice * l.quantity)}`).join('\n');
}

const totalOf = (items) => items.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

/** Semantic validation: is `input` a whole number between 1 and max? Returns the number or null. */
function parseChoice(input, max) {
  const n = Number(input);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

// ------------------------------- the bot -------------------------------------

function createChatbot({ orderService, paymentService, clock = () => new Date() }) {
  /** Lazily create this session's chat state the first time we see it. */
  function chatOf(session) {
    if (!session.chat) session.chat = { state: STATES.MAIN, cart: [], pendingItemIndex: null };
    return session.chat;
  }

  function goToMain(chat) {
    chat.state = STATES.MAIN;
    chat.pendingItemIndex = null;
  }

  /** Called when the page loads. Shows any notice (e.g. "payment successful") then the main menu. */
  async function welcome(session) {
    const chat = chatOf(session);
    goToMain(chat); // a page reload shouldn't leave you stuck mid-flow; the cart is kept
    const messages = [];
    if (session.notice) {
      messages.push(msg(session.notice));
      delete session.notice; // a "flash" message: shown exactly once
    }
    messages.push(msg(`Welcome to Mama Tee's Kitchen 🍲\nWhat would you like to do?\n\n${MAIN_MENU}`));
    return messages;
  }

  /** Called for every customer message. `input` has already passed syntactic validation (digits only). */
  async function handle(session, input) {
    const chat = chatOf(session);

    const globalCommand = GLOBAL_COMMANDS[input];
    if (globalCommand) return globalCommand(session, chat);

    switch (chat.state) {
      case STATES.SELECTING_ITEM:
        return handleItemChoice(chat, input);
      case STATES.SELECTING_OPTION:
        return handleOptionChoice(chat, input);
      case STATES.SCHEDULING:
        return handleScheduleChoice(session, chat, input);
      case STATES.MAIN:
      default:
        return handleMainChoice(chat, input);
    }
  }

  // ----- state handlers -----

  function handleMainChoice(chat, input) {
    if (input === '1') {
      chat.state = STATES.SELECTING_ITEM;
      return [msg(itemsText())];
    }
    goToMain(chat);
    return [msg(`Sorry, "${input}" isn't one of the options.\n\n${MAIN_MENU}`)];
  }

  function handleItemChoice(chat, input) {
    const choice = parseChoice(input, MENU.length);
    if (!choice) return [msg(`Please choose an item between 1 and ${MENU.length}.\n\n${itemsText()}`)];

    const itemIndex = choice - 1;
    const item = MENU[itemIndex];
    if (item.options.length === 1) return addToCart(chat, itemIndex, 0);

    chat.state = STATES.SELECTING_OPTION;
    chat.pendingItemIndex = itemIndex;
    return [msg(optionsText(item))];
  }

  function handleOptionChoice(chat, input) {
    const item = MENU[chat.pendingItemIndex];
    if (!item) {
      // Defensive: the menu changed under an old session. Recover instead of crashing.
      chat.state = STATES.SELECTING_ITEM;
      return [msg(itemsText())];
    }
    const choice = parseChoice(input, item.options.length);
    if (!choice) return [msg(`Please choose an option between 1 and ${item.options.length}.\n\n${optionsText(item)}`)];
    return addToCart(chat, chat.pendingItemIndex, choice - 1);
  }

  async function handleScheduleChoice(session, chat, input) {
    const choice = parseChoice(input, SCHEDULE_CHOICES.length);
    if (!choice) return [msg(`Please choose between 1 and ${SCHEDULE_CHOICES.length}.\n\n${scheduleText()}`)];
    if (chat.cart.length === 0) {
      goToMain(chat);
      return [msg(`There's no current order to schedule.\n\n${MAIN_MENU}`)];
    }

    const scheduledFor = new Date(clock().getTime() + SCHEDULE_CHOICES[choice - 1].minutes * 60_000);
    const order = await orderService.createFromCart(session.deviceId, chat.cart, { scheduledFor });
    chat.cart = []; // only cleared AFTER the order is safely saved
    goToMain(chat);
    return [
      msg(`Order scheduled ⏰\nOrder #${shortRef(order)} will be placed at ${formatTime(scheduledFor)}.\n\n${linesText(order.items)}\nTotal: ${formatNaira(order.total)}`),
      msg('Select 95 to pay for this order now\nSelect 1 to place a new order\nSelect 98 to see order history'),
    ];
  }

  function addToCart(chat, itemIndex, optionIndex) {
    const item = MENU[itemIndex];
    const option = item.options[optionIndex];
    const existing = chat.cart.find((l) => l.name === item.name && l.option === option.name);
    chat.state = STATES.SELECTING_ITEM; // whatever happens below, the next number picks an item
    chat.pendingItemIndex = null;

    if (existing) {
      if (existing.quantity >= LIMITS.maxQuantityPerLine) {
        return [msg(`You already have the maximum of ${LIMITS.maxQuantityPerLine} x ${item.name} (${option.name}).`)];
      }
      existing.quantity += 1;
    } else {
      if (chat.cart.length >= LIMITS.maxCartLines) {
        return [msg(`Your order already has ${LIMITS.maxCartLines} different items. Select 99 to checkout.`)];
      }
      // Snapshot name + price from OUR menu. The client only ever sent a number.
      chat.cart.push({ name: item.name, option: option.name, unitPrice: option.price, quantity: 1 });
    }

    return [
      msg(`Added 1 x ${item.name} (${option.name}) ✅\n\n${linesText(chat.cart)}\nTotal so far: ${formatNaira(totalOf(chat.cart))}`),
      msg(`Reply with another item number (1–${MENU.length}) to add more, or:\nSelect 99 to checkout order\nSelect 97 to see current order\nSelect 0 to cancel order`),
    ];
  }

  // ----- global commands -----

  async function checkout(session, chat) {
    if (chat.cart.length === 0) {
      goToMain(chat);
      return [msg('No order to place.'), msg('Select 1 to place a new order')];
    }
    const order = await orderService.createFromCart(session.deviceId, chat.cart);
    chat.cart = [];
    goToMain(chat);
    return [
      msg(`Order placed ✅\nOrder #${shortRef(order)}\n\n${linesText(order.items)}\nTotal: ${formatNaira(order.total)}`),
      msg('Select 95 to pay for this order\nSelect 1 to place a new order\nSelect 98 to see order history'),
    ];
  }

  async function history(session) {
    const orders = await orderService.listForDevice(session.deviceId);
    if (orders.length === 0) return [msg('You have no placed orders yet.\n\nSelect 1 to place an order')];

    const blocks = orders.map((o) => {
      const when = o.status === 'scheduled' ? `Scheduled for ${formatTime(o.scheduledFor)}` : `Placed ${formatTime(o.createdAt)}`;
      const paid = o.paymentStatus === 'paid' ? 'Paid ✅' : 'Unpaid';
      return `#${shortRef(o)} · ${when} · ${paid}\n${linesText(o.items)}\nTotal: ${formatNaira(o.total)}`;
    });
    return [msg(`Your orders (newest first):\n\n${blocks.join('\n\n')}`), msg(MAIN_MENU)];
  }

  function currentOrder(_session, chat) {
    if (chat.cart.length === 0) return [msg('You have no current order.\n\nSelect 1 to place an order')];
    return [
      msg(`Your current order:\n\n${linesText(chat.cart)}\nTotal: ${formatNaira(totalOf(chat.cart))}`),
      msg('Select 99 to checkout order\nSelect 96 to schedule it for later\nSelect 0 to cancel order'),
    ];
  }

  function scheduleText() {
    const lines = SCHEDULE_CHOICES.map((c, i) => `${i + 1}. ${c.label}`);
    return `When should we place this order?\n\n${lines.join('\n')}`;
  }

  function startScheduling(_session, chat) {
    if (chat.cart.length === 0) {
      goToMain(chat);
      return [msg('There is no current order to schedule.\n\nSelect 1 to place an order')];
    }
    chat.state = STATES.SCHEDULING;
    return [msg(scheduleText())];
  }

  async function pay(session) {
    const order = await orderService.latestUnpaid(session.deviceId);
    if (!order) return [msg('You have no unpaid orders. Select 99 to checkout your current order first, or 1 to start one.')];

    try {
      const url = await paymentService.startPayment(order);
      return [
        msg(`Order #${shortRef(order)} — Total ${formatNaira(order.total)}\nTap the button below to pay securely with Paystack. You'll be brought back here afterwards.`, {
          link: { label: `Pay ${formatNaira(order.total)} with Paystack`, url },
        }),
      ];
    } catch (err) {
      // A Paystack outage shouldn't look like OUR app crashing; tell the customer what to do.
      console.error('[chatbot] could not start payment:', err.message);
      return [msg("Sorry, we couldn't reach the payment provider just now. Please select 95 again in a moment.")];
    }
  }

  function cancel(_session, chat) {
    const hadOrder = chat.cart.length > 0;
    chat.cart = [];
    goToMain(chat);
    return [msg(hadOrder ? 'Your current order has been cancelled.' : 'There is no current order to cancel.'), msg(MAIN_MENU)];
  }

  const GLOBAL_COMMANDS = Object.freeze({
    99: checkout,
    98: history,
    97: currentOrder,
    96: startScheduling,
    95: pay,
    0: cancel,
  });

  return { welcome, handle };
}

module.exports = { createChatbot, STATES, MAIN_MENU, SCHEDULE_CHOICES, LIMITS };