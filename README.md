# Juntos 📞

A tiny private video-call app for two people, with built-in games — designed so a 7-year-old can use it, and so calls end *together*: the call only hangs up when **both sides press the red button**, finishing with a high-five animation. No accounts, no database, no server-side code.

## How it works

- **Video/audio** travels **peer-to-peer** (WebRTC), end-to-end encrypted between the two devices. Nothing is recorded and no video ever touches a server.
- **Signaling** (the initial "find each other" handshake) uses the free public **PeerJS** cloud server.
- **Vercel** only serves these static files.
- **Games** run over a WebRTC data channel on the same connection.

## Using it

1. Both people open the site.
2. Type your name + the same secret room name (e.g. `dragon-azul`).
3. Whoever enters first opens the room; the second one joins automatically.
4. Or share a direct link from the waiting screen — it looks like `https://yourapp.vercel.app/#sala=dragon-azul`, and the room is pre-filled when opened.

Tip: agree on one permanent room name and bookmark the link on the kid's device — then joining is just tap → type name once → big green button.

### Hanging up together

Pressing **Colgar** doesn't end the call. It tells the other side "X wants to hang up — press your red button too!" The call ends only when both have pressed (with a high-five 🙌 goodbye screen). If the other side doesn't press within 25 seconds, it auto-cancels and the call continues. Either side can also tap "¡Seguimos hablando!" to cancel.

### Games (🎮 button)

| Game | What happens |
|---|---|
| 🎨 Píntame la cara | Snapshots the *other* person's face, gives a prompt (pirate, alien, cat…), you each doodle on each other, then swap masterpieces |
| 📸 Pon la cara | Same emoji appears on both screens, 3-2-1 countdown, both photos shown side by side |
| ⭕ Tres en raya | Tic-tac-toe |
| ✂️ Piedra, papel, tijera | Rock-paper-scissors with a running score |
| ✏️ Dibuja y adivina | One draws live (strokes stream in real time), the other guesses from 4 options |
| 🤔 ¿Qué prefieres? | Silly would-you-rather questions; see if you picked the same |

The video stays on-screen (shrunk to a strip at the top) during every game. UI is Spanish by default with an EN toggle on the home screen.

## Deploy (GitHub + Vercel)

```bash
cd juntos
git init && git add -A && git commit -m "Juntos v1"
gh repo create juntos --private --source=. --push   # or create the repo on github.com and push
```

Then in Vercel: **Add New → Project → import the repo**. Framework preset: **Other**. No build command, no output directory settings needed — it's plain static files. Deploy. Done.

(Camera access requires HTTPS, which Vercel gives you automatically. `localhost` also works for testing.)

## Testing locally

```bash
npx serve .
```

Open two browser windows (or laptop + phone on the same network via HTTPS/localhost) and join the same room.

## If video won't connect on some networks

Most home Wi-Fi and mobile networks work with the free STUN/TURN servers already configured. If one side is on a very strict carrier network and video never appears:

1. Create a free account at [metered.ca](https://www.metered.ca/tools/openrelay/) (or any TURN provider).
2. Replace the `turn:` entries in the `ICE` object near the top of `app.js` with your own credentials.

## Notes

- The room name is the only "key" — pick something unguessable-ish (`dragon-azul-7742`) since anyone who knows it could join the room while it's empty. It's a 2-person room: once you're both in, a third device can't take over the host slot.
- If the connection drops (bad Wi-Fi), both sides just re-enter the same room.
- Works best in Chrome/Edge on Android and Safari on iOS. First join must be a tap (browsers require a user gesture to open the camera) — the big green button handles that.
