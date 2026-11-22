"use strict";
function startScheduler({
  orderService,
  intervalMs = 30_000,
  logger = console,
}) {
  let running = false;

  async function tick() {
    if (running) return; // don't overlap if one run is slow
    running = true;
    try {
      const released = await orderService.releaseDueScheduledOrders(new Date());
      if (released > 0)
        logger.info(`[scheduler] placed ${released} scheduled order(s)`);
    } catch (err) {
      logger.error("[scheduler] tick failed:", err.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref(); // don't keep the process alive just for this timer
  tick();
  return () => clearInterval(timer);
}

module.exports = { startScheduler };
