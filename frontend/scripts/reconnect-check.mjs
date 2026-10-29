// Signaling recovery check: two headless browsers join a call, the backend restarts mid-call
// (uvicorn --reload picks up a touched file), and both sides must reconnect and exchange a chat message.
// Needs the dev servers running with --reload. Usage: node scripts/reconnect-check.mjs
import { readFileSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://localhost:3000";
const API = process.env.API ?? "http://127.0.0.1:8000";

/** Node resolves "localhost" to ::1 but uvicorn listens on 127.0.0.1, so API calls from Node use the IPv4
 *  address; the session cookie is then copied to "localhost", where the pages (and their API calls) run. */
async function apiLogin(ctx, email, password) {
  const res = await ctx.request.post(`${API}/api/auth/login`, { data: { email, password } });
  if (res.ok()) {
    const cookies = await ctx.cookies(API);
    await ctx.addCookies(cookies.map(({ name, value, path, httpOnly, secure, sameSite, expires }) => ({ name, value, path, httpOnly, secure, sameSite, expires, domain: "localhost" })));
  }
  return res;
}
const user = JSON.parse(readFileSync(path.join(here, "../../backend/seed/dev_users.json"), "utf8")).users[0];
const touchFile = path.join(here, "../../backend/app/main.py");

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const viewport = { width: 1280, height: 800 };
try {
  const host = await browser.newContext({ viewport });
  if (!(await apiLogin(host, user.email, user.password)).ok()) throw new Error("login failed");
  const { code } = await (await host.request.post(`${API}/api/meetings`)).json();
  // Count signaling sockets the page opens, so we can prove a reconnect really happened.
  await host.addInitScript(() => {
    const Native = window.WebSocket;
    window.__wsOpened = 0;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes("/ws/meetings/")) window.__wsOpened++;
      }
    };
  });
  const hp = await host.newPage();
  await hp.goto(`${BASE}/m/${code}?fake=1`);
  await hp.getByRole("button", { name: "Join call" }).click();

  const guest = await browser.newContext({ viewport });
  const gp = await guest.newPage();
  await gp.goto(`${BASE}/m/${code}?fake=1`);
  await gp.getByLabel("Your name").fill("Guest Tester");
  await gp.getByRole("button", { name: "Join call" }).click();
  await hp.getByText("Guest Tester").first().waitFor({ timeout: 20000 });
  console.log("connected");

  const now = new Date();
  utimesSync(touchFile, now, now); // uvicorn --reload restarts the backend -> every WebSocket drops
  await hp.waitForFunction(() => window.__wsOpened >= 2, null, { timeout: 60000 });
  console.log("backend restarted; host opened a new signaling connection");

  // Both sides rejoin; the newcomer re-offers. Wait until the chat box is usable again.
  const box = hp.getByPlaceholder("Message Guest Tester");
  await box.waitFor({ timeout: 60000 });
  await hp.waitForFunction(() => {
    const el = document.querySelector("#chat-input");
    return el && !el.disabled;
  }, null, { timeout: 60000 });
  await box.fill("still here after the restart");
  await hp.getByRole("button", { name: "Send message" }).click();
  if (!(await gp.getByRole("tab", { name: "Chat" }).isVisible())) await gp.getByRole("button", { name: /^Chat/ }).click();
  await gp.getByText("still here after the restart").first().waitFor({ timeout: 15000 });
  console.log("RECONNECT OK: message delivered after backend restart");
  await host.request.post(`${API}/api/meetings/${code}/end`);
} finally {
  await browser.close();
}
