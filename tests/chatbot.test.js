"use strict";

const { createChatbot, STATES } = require("../src/services/chatbot.service");
const { createFakeOrderService } = require("./helpers/fakes");

const text = (messages) => messages.map((m) => m.text).join("\n---\n");

function setup() {
  const orderService = createFakeOrderService();
  const paymentService = {
    startPayment: jest.fn(async () => "https://checkout.paystack.com/abc"),
  };
  const now = new Date("2026-11-16T12:00:00Z");
  const bot = createChatbot({ orderService, paymentService, clock: () => now });
  const session = { deviceId: "device-1" };
  const say = (input) => bot.handle(session, input);
  return { bot, session, say, orderService, paymentService, now };
}

describe("chatbot conversation", () => {
  test("welcome shows all the main options", async () => {
    const { bot, session } = setup();
    const out = text(await bot.welcome(session));
    for (const option of [
      "Select 1 to Place an order",
      "Select 99 to checkout order",
      "Select 98 to see order history",
      "Select 97 to see current order",
      "Select 0 to cancel order",
    ]) {
      expect(out).toContain(option);
    }
  });

  test("1 lists the menu; an item with options asks for the option; picking it adds to the cart", async () => {
    const { say, session } = setup();
    expect(text(await say("1"))).toContain("1. Jollof Rice");
    expect(session.chat.state).toBe(STATES.SELECTING_ITEM);

    expect(text(await say("1"))).toContain("2. Large"); // "1" now means Jollof
    expect(session.chat.state).toBe(STATES.SELECTING_OPTION);

    expect(text(await say("2"))).toContain("Added 1 x Jollof Rice (Large)"); // "2" now means Large
    expect(session.chat.cart).toEqual([
      { name: "Jollof Rice", option: "Large", unitPrice: 350000, quantity: 1 },
    ]);
  });

  test("an item with a single option is added immediately; repeats increase quantity", async () => {
    const { say, session } = setup();
    await say("1");
    await say("5"); // Small Chops Platter
    await say("5");
    expect(session.chat.cart).toEqual([
      {
        name: "Small Chops Platter",
        option: "Standard",
        unitPrice: 400000,
        quantity: 2,
      },
    ]);
  });

  test("out-of-range choices are rejected without changing anything", async () => {
    const { say, session } = setup();
    expect(text(await say("7"))).toContain("isn't one of the options"); // main menu
    await say("1");
    expect(text(await say("9"))).toContain("between 1 and 6");
    await say("3"); // Chicken
    expect(text(await say("4"))).toContain("between 1 and 3");
    expect(session.chat.cart).toHaveLength(0);
  });

  test("97 shows the current order with its total", async () => {
    const { say } = setup();
    await say("1");
    await say("6");
    await say("1"); // Chapman
    await say("3");
    await say("2"); // Grilled chicken
    const out = text(await say("97"));
    expect(out).toContain("1 x Drinks (Chapman)");
    expect(out).toContain("1 x Chicken (Grilled)");
    expect(out).toContain("Total: ₦3,700");
  });

  test('99 with no current order says "No order to place" and offers a new order', async () => {
    const { say } = setup();
    const out = text(await say("99"));
    expect(out).toContain("No order to place");
    expect(out).toContain("Select 1 to place a new order");
  });

  test("99 places the order, empties the cart and offers to pay or start again", async () => {
    const { say, session, orderService } = setup();
    await say("1");
    await say("5");
    const out = text(await say("99"));
    expect(out).toContain("Order placed");
    expect(out).toContain("Select 1 to place a new order");
    expect(out).toContain("Select 95 to pay");
    expect(session.chat.cart).toHaveLength(0);
    expect(orderService.orders).toHaveLength(1);
    expect(orderService.orders[0]).toMatchObject({
      deviceId: "device-1",
      total: 400000,
      status: "placed",
    });
  });

  test("global commands work in the middle of choosing an option", async () => {
    const { say, session } = setup();
    await say("1");
    await say("5");
    await say("1"); // mid-way through choosing a Jollof size
    expect(session.chat.state).toBe(STATES.SELECTING_OPTION);
    expect(text(await say("99"))).toContain("Order placed");
    expect(session.chat.state).toBe(STATES.MAIN);
  });

  test("0 cancels the current order if there is one", async () => {
    const { say, session } = setup();
    expect(text(await say("0"))).toContain("no current order to cancel");
    await say("1");
    await say("5");
    expect(text(await say("0"))).toContain("has been cancelled");
    expect(session.chat.cart).toHaveLength(0);
  });

  test("98 lists placed orders, newest first, only for this device", async () => {
    const { say, bot, orderService } = setup();
    expect(text(await say("98"))).toContain("no placed orders");

    await say("1");
    await say("5");
    await say("99");
    await say("1");
    await say("6");
    await say("2");
    await say("99");
    const other = { deviceId: "someone-else" };
    for (const input of ["1", "3", "1", "99"]) await bot.handle(other, input); // another device orders Fried chicken

    const out = text(await say("98"));
    expect(out.indexOf("Zobo")).toBeLessThan(out.indexOf("Small Chops")); // newest first
    expect(out).not.toContain("Chicken"); // other device's order is not visible
    expect(orderService.orders).toHaveLength(3);
  });

  test("96 schedules the current order for later", async () => {
    const { say, session, orderService, now } = setup();
    expect(text(await say("96"))).toContain("no current order to schedule");

    await say("1");
    await say("5");
    expect(text(await say("96"))).toContain("2. In 1 hour");
    expect(session.chat.state).toBe(STATES.SCHEDULING);
    expect(text(await say("2"))).toContain("Order scheduled");

    const [order] = orderService.orders;
    expect(order.status).toBe("scheduled");
    expect(order.scheduledFor.getTime() - now.getTime()).toBe(60 * 60 * 1000);
    expect(session.chat.cart).toHaveLength(0);
  });

  test("95 returns a Paystack link for the latest unpaid order", async () => {
    const { say, paymentService } = setup();
    expect(text(await say("95"))).toContain("no unpaid orders");

    await say("1");
    await say("5");
    await say("99");
    const [reply] = await say("95");
    expect(reply.link).toEqual({
      label: "Pay ₦4,000 with Paystack",
      url: "https://checkout.paystack.com/abc",
    });
    expect(paymentService.startPayment).toHaveBeenCalledTimes(1);
  });

  test("95 explains politely if Paystack is down", async () => {
    const { say, paymentService } = setup();
    paymentService.startPayment.mockRejectedValueOnce(new Error("timeout"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    await say("1");
    await say("5");
    await say("99");
    expect(text(await say("95"))).toContain(
      "couldn't reach the payment provider",
    );
  });

  test("welcome delivers a one-time notice (e.g. payment success)", async () => {
    const { bot, session } = setup();
    session.notice = "Payment successful 🎉";
    expect(text(await bot.welcome(session))).toContain("Payment successful");
    expect(text(await bot.welcome(session))).not.toContain(
      "Payment successful",
    );
  });
});