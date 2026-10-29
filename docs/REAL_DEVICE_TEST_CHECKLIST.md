# Real-device test checklist

Everything below has been tested automatically with **substitute** cameras (a test pattern, or a
recorded INCLUDE clip played as the camera) in headless Chrome. These checks need real hardware or a
real person, so they are still **unverified**. Tick them off when you happen to try them; none
requires recording training data.

Start the app: run the `backend` and `frontend` launch configurations, or see the README. For
phones, use `npm run dev:https` (self-signed certificate, LAN only).

## Camera and sign recognition (one laptop)
- [ ] `/try`: press **Turn on camera**, allow it; the strip goes from "Loading sign recognition…" to "Ready — raise your hands to sign". Note how many seconds that takes.
- [ ] Sign **Hello** slowly, then put your hands down: the result shows "Recognised — Hello", or a
      "which sign?" list containing Hello.
- [ ] Do a gesture that isn't in the dictionary (e.g. scratch your head): you should see "No supported
      sign detected", or a choice list. **A word appearing as "Recognised" is a false accept — note it.**
- [ ] Recognition latency feels instant (the result appears within about a second of hands down).

## A call between two devices on the same Wi-Fi
- [ ] Laptop: create a meeting, and **Copy link**. Phone: open the link and join as a guest.
- [ ] Video both ways; the signer's video is never cropped.
- [ ] Phone (375-wide screen): all six controls are visible and tappable; the chat and pictures sheet
      opens and closes.
- [ ] Mic mute and camera off reach the other side ("muted" label).
- [ ] Signer turns **Signs** on. The strip under the video goes from "Loading sign recognition…" (about
      7–11 s on this laptop) to "Ready — raise your hands to sign". Note how long it takes on your machine.
- [ ] With hands out of view, the strip says "Hands not seen". Raising a hand → "Watching your sign…".
- [ ] Sign **Doctor**, then hands down: a countdown card appears under the video (not over it). After 2 s
      the strip says "Sent “Doctor”" and the other side sees "Doctor" once, and hears it.
- [ ] Keep your hands up for 10 s: at most one card appears, not one every few seconds.
- [ ] Do a gesture that isn't a supported sign: "No supported sign detected", or a "which sign?" choice.
      Nothing reaches the other side unless you tap a choice (it then shows "chosen by the signer").
- [ ] While signing, the buttons and chat stay responsive (no freezes).
- [ ] Hearing person turns on **Captions** (Chrome/Edge): spoken words appear for the signer, and
      the signer sees sign clips for the words that have one.
- [ ] **Read aloud** speaks incoming signs and messages on the hearing side; you can hear it.
- [ ] Picture board: tap "Water" — the other side sees and hears it.
- [ ] Turn the phone's Wi-Fi off for 10 s and back on: the call says "reconnecting…" and comes back.
- [ ] Host taps **End meeting** twice: the guest sees "This meeting has ended."

## Across networks (needs a TURN server)
- [ ] With the phone on mobile data and the laptop on Wi-Fi, the call connects. Without TURN this is
      expected to fail on many networks; configure `TURN_URLS` + `TURN_SECRET` (`backend/.env.example`).

## My signs (one laptop)
- [ ] `/my-signs` → **Add a sign**, name it (e.g. a family member), record it 3–5 times; the takes show as ticks and "Takes are consistent".
- [ ] On `/try`, sign it: "Looks like one of your signs" appears. Note how often it is recognised out of 10 tries, and whether ordinary movements ever trigger it.
- [ ] In a call, sign it: "Is this your sign?" appears; nothing is sent until you tap it.

## Website (any device)
- [ ] On a phone, the landing page reads well, the menu opens and closes, and "How it works" scrolls smoothly to its section.
- [ ] With the system set to *reduce motion*, nothing animates and nothing stays hidden.
- [ ] Create an account, set preferences, then **Settings → Delete account**: you are signed out and can't sign in again.

## Accessibility
- [ ] Every control can be reached with Tab and shows a visible focus ring.
- [ ] A screen reader announces the call controls and the "Recognised sign" card.
- [ ] Ideally: a Deaf ISL user tries a call and says what is confusing.

## Deployment
- [ ] `docker compose up` (Docker isn't installed on the development machine; the compose file is untested).
