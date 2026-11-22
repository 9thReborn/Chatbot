"use strict";

const messagesEl = document.getElementById("messages");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const hint = document.getElementById("hint");
const sendButton = form.querySelector("button");

// Only ever render payment links that point at Paystack's checkout.
const ALLOWED_LINK_PREFIX = "https://checkout.paystack.com/";

function addMessage(from, text, link) {
  const bubble = document.createElement("div");
  bubble.className = `msg msg--${from}`;

  // textContent, NEVER innerHTML: whatever text arrives is displayed as text,
  // not executed as HTML. This is the main defence against XSS.
  const p = document.createElement("p");
  p.textContent = text;
  bubble.append(p);

  if (
    link &&
    typeof link.url === "string" &&
    link.url.startsWith(ALLOWED_LINK_PREFIX)
  ) {
    const a = document.createElement("a");
    a.href = link.url; // same tab: Paystack redirects back into this chat afterwards
    a.textContent = link.label;
    a.className = "msg__action";
    bubble.append(a);
  }

  messagesEl.append(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function renderBotMessages(messages = []) {
  for (const m of messages) addMessage("bot", m.text, m.link);
}

async function callApi(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    // Our server always answers { messages: [...] }, even for errors (400/429/500).
    const data = await res.json();
    return data.messages;
  } catch {
    return [
      {
        text: "Can't reach the restaurant right now. Check your connection and try again.",
      },
    ];
  }
}

function setBusy(busy) {
  input.disabled = busy;
  sendButton.disabled = busy;
  if (!busy) input.focus();
}

async function start() {
  // After Paystack redirects us to /?payment=success, tidy the URL so a
  // refresh doesn't look like a second payment. The server already queued the
  // "payment successful" notice in our session; /welcome will deliver it.
  if (window.location.search) window.history.replaceState(null, "", "/");

  setBusy(true);
  renderBotMessages(await callApi("/api/chat/welcome"));
  setBusy(false);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();

  // Client-side check is for quick feedback only; the server validates again.
  if (!/^\d{1,3}$/.test(value)) {
    hint.textContent = "Please type one of the numbers shown, e.g. 1, 97 or 0.";
    return;
  }
  hint.textContent = "";
  input.value = "";

  addMessage("user", value);
  setBusy(true);
  const typing = addMessage("bot", "…");
  typing.classList.add("msg--typing");

  const messages = await callApi("/api/chat/message", {
    method: "POST",
    body: JSON.stringify({ message: value }),
  });

  typing.remove();
  renderBotMessages(messages);
  setBusy(false);
});

start();