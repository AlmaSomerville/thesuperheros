/* ============================================================
   Juntos 📞 — core app
   - PeerJS signaling (free public server), WebRTC P2P media
   - Dual "hang up together" button
   - Robust connect: retry loop, ghost-host recovery, auto-reconnect
   - Game framework (games register themselves from games.js)
   ============================================================ */

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");
function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  show(t);
  clearTimeout(t._tm);
  t._tm = setTimeout(() => hide(t), ms);
}
function switchView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $(id).classList.add("active");
}

// ============================================================
// ⚠️ TURN SERVER — IMPORTANT FOR MOBILE DATA (4G/5G) CALLS
// Wi-Fi ↔ Wi-Fi usually works with STUN alone, but phone-to-phone
// on mobile data almost always needs a TURN relay.
// Get FREE credentials (50 GB/month) in ~2 minutes:
//   1. Sign up at https://dashboard.metered.ca/signup
//   2. Create a "TURN credential" → copy username + credential
//   3. Paste them below. That's it.
// ============================================================
const TURN_USERNAME = "";   // ← paste here
const TURN_CREDENTIAL = ""; // ← paste here

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    ...(TURN_USERNAME && TURN_CREDENTIAL
      ? [
          { urls: "turn:global.relay.metered.ca:80", username: TURN_USERNAME, credential: TURN_CREDENTIAL },
          { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: TURN_USERNAME, credential: TURN_CREDENTIAL },
          { urls: "turn:global.relay.metered.ca:443", username: TURN_USERNAME, credential: TURN_CREDENTIAL },
          { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: TURN_USERNAME, credential: TURN_CREDENTIAL },
        ]
      : [
          // Fallback public relay — often overloaded/unreliable.
          // Really do grab your own free credentials above.
          { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
          { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
        ]),
  ],
};

// ---------- i18n ----------
const I18N = {
  es: {
    tagline: "Videollamadas con juegos, para nosotros dos",
    yourName: "¿Cómo te llamas?",
    roomCode: "Nombre secreto de la sala",
    enterCall: "Entrar a la llamada",
    homeHint: "Los dos tenéis que escribir el mismo nombre de sala. El primero que entra abre la sala; el otro se une.",
    waiting: "Esperando al otro lado…",
    room: "Sala",
    shareLink: "Compartir enlace",
    back: "Volver",
    endCall: "Colgar",
    keepTalking: "¡Seguimos hablando!",
    pickGame: "¿A qué jugamos?",
    close: "Cerrar",
    byeTitle: "¡Chocadas!",
    byeText: "Hasta muy pronto 👋💛",
    backHome: "Volver al inicio",
    needName: "Escribe tu nombre 😊",
    needRoom: "Escribe el nombre de la sala 😊",
    connecting: "Conectando…",
    retrying: (n) => `Conectando… (intento ${n})`,
    reconnecting: "Se cortó la llamada. Reconectando… 🔄",
    linkCopied: "¡Enlace copiado! Envíaselo 📨",
    theyWantHangup: (n) => `${n} quiere colgar 👋 ¡Pulsa tú también el botón rojo para despediros!`,
    waitingHangup: (n) => `Esperamos a que ${n} también pulse Colgar… ¡chocaréis las manos! 🙌`,
    hangupCancelled: "¡Seguimos! 🎉",
    camError: "No puedo abrir la cámara. Revisa los permisos del navegador 🎥",
    connError: "No me puedo conectar. Probad a entrar otra vez.",
    friend: "Amigo",
    me: "Yo",
    quitGame: "Salir del juego",
    playAgain: "Otra vez",
  },
  en: {
    tagline: "Video calls with games, just for us two",
    yourName: "What's your name?",
    roomCode: "Secret room name",
    enterCall: "Join the call",
    homeHint: "You both type the same room name. Whoever arrives first opens the room; the other one joins.",
    waiting: "Waiting for the other side…",
    room: "Room",
    shareLink: "Share link",
    back: "Back",
    endCall: "Hang up",
    keepTalking: "Keep talking!",
    pickGame: "What shall we play?",
    close: "Close",
    byeTitle: "High five!",
    byeText: "See you very soon 👋💛",
    backHome: "Back home",
    needName: "Type your name 😊",
    needRoom: "Type the room name 😊",
    connecting: "Connecting…",
    retrying: (n) => `Connecting… (attempt ${n})`,
    reconnecting: "The call dropped. Reconnecting… 🔄",
    linkCopied: "Link copied! Send it over 📨",
    theyWantHangup: (n) => `${n} wants to hang up 👋 Press the red button too so you can say bye together!`,
    waitingHangup: (n) => `Waiting for ${n} to press Hang up too… then you high-five! 🙌`,
    hangupCancelled: "We keep going! 🎉",
    camError: "Can't open the camera. Check browser permissions 🎥",
    connError: "Can't connect. Try joining again.",
    friend: "Friend",
    me: "Me",
    quitGame: "Leave game",
    playAgain: "Again",
  },
};
let lang = localStorage.getItem("juntos-lang") || "es";
function t(key, ...args) {
  const v = I18N[lang][key];
  return typeof v === "function" ? v(...args) : v;
}
function applyLang() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $("lang-toggle").textContent = lang === "es" ? "EN" : "ES";
  document.documentElement.lang = lang;
}
$("lang-toggle").onclick = () => {
  lang = lang === "es" ? "en" : "es";
  localStorage.setItem("juntos-lang", lang);
  applyLang();
};

// ---------- global state ----------
const S = {
  myName: localStorage.getItem("juntos-name") || "",
  room: "",
  peer: null,
  conn: null,
  call: null,
  localStream: null,
  remoteName: "",
  isHost: false,
  inCall: false,
  closing: false,       // user intentionally left → stop all retries
  myEndPressed: false,
  theirEndPressed: false,
  hangupTimer: null,
  retryTimer: null,
  watchdogTimer: null,
  currentGame: null,
};

const roomToId = (room) =>
  "juntos-" +
  room.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 32);

// ---------- home / join ----------
(function initHome() {
  applyLang();
  $("name-input").value = S.myName;
  const hashRoom = decodeURIComponent((location.hash.match(/sala=([^&]+)/) || [])[1] || "");
  if (hashRoom) $("room-input").value = hashRoom;
})();

$("btn-join").onclick = async () => {
  const name = $("name-input").value.trim();
  const room = $("room-input").value.trim();
  if (!name) return toast(t("needName"));
  if (!room) return toast(t("needRoom"));
  S.myName = name;
  S.room = room;
  localStorage.setItem("juntos-name", name);
  await startSession();
};

$("btn-share").onclick = async () => {
  const url = `${location.origin}${location.pathname}#sala=${encodeURIComponent(S.room)}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Juntos 📞", url }); } catch (_) {}
  } else {
    await navigator.clipboard.writeText(url);
    toast(t("linkCopied"));
  }
};

$("btn-cancel-wait").onclick = () => cleanup(true);
$("btn-bye-home").onclick = () => switchView("view-home");

// Release our peer ID cleanly when the page closes — this is what
// prevents "ghost" hosts from blocking the room on the next join.
window.addEventListener("pagehide", () => { try { S.peer && S.peer.destroy(); } catch (_) {} });
window.addEventListener("beforeunload", () => { try { S.peer && S.peer.destroy(); } catch (_) {} });

// ---------- session / connection state machine ----------
async function startSession() {
  switchView("view-wait");
  $("wait-room-code").textContent = S.room;
  $("wait-status").textContent = t("connecting");

  if (!S.localStream) {
    try {
      S.localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      toast(t("camError"), 4000);
      switchView("view-home");
      return;
    }
    $("local-video").srcObject = S.localStream;
  }
  S.closing = false;
  attemptConnect(1);
}

function destroyPeer() {
  clearTimeout(S.watchdogTimer);
  try { S.call && S.call.close(); } catch (_) {}
  try { S.conn && S.conn.close(); } catch (_) {}
  try { S.peer && S.peer.destroy(); } catch (_) {}
  S.peer = S.conn = S.call = null;
}

function attemptConnect(n) {
  if (S.closing) return;
  destroyPeer();
  if (n > 1) $("wait-status").textContent = t("retrying", n);

  const hostId = roomToId(S.room);
  const peer = new Peer(hostId, { config: ICE });
  S.peer = peer;
  let decided = false;

  peer.on("open", () => {
    if (decided) return;
    decided = true;
    S.isHost = true;
    $("wait-status").textContent = "";
    hostMode(peer);
  });
  peer.on("error", (err) => {
    if (err.type === "unavailable-id") {
      // Room already has a host (real — or a ghost from a closed tab).
      if (!decided) { decided = true; guestMode(hostId, n); }
    } else {
      scheduleRetry(n, err);
    }
  });
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (_) {} });
}

function hostMode(peer) {
  S.isHost = true;
  peer.on("connection", (conn) => {
    // A newer guest connection always replaces the old one
    try { S.conn && S.conn.close(); } catch (_) {}
    setupConn(conn);
  });
  peer.on("call", (call) => {
    try { S.call && S.call.close(); } catch (_) {}
    S.call = call;
    call.answer(S.localStream);
    wireCall(call);
  });
}

function guestMode(hostId, n) {
  destroyPeer();
  const peer = new Peer({ config: ICE });
  S.peer = peer;

  peer.on("open", () => {
    const conn = peer.connect(hostId, { reliable: true });
    setupConn(conn);
    const call = peer.call(hostId, S.localStream);
    S.call = call;
    wireCall(call);
    // Watchdog: if no video arrives, the "host" may be a ghost or the
    // network path failed — tear down and retry. Ghost IDs expire on the
    // signaling server within ~1 minute, after which we claim host.
    clearTimeout(S.watchdogTimer);
    S.watchdogTimer = setTimeout(() => {
      if (!S.inCall && !S.closing) scheduleRetry(n);
    }, 12000);
  });
  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") scheduleRetry(n); // ghost just expired
    else scheduleRetry(n, err);
  });
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (_) {} });
}

function scheduleRetry(n, err) {
  if (S.closing || S.inCall) return;
  if (err) console.warn("retrying after peer error:", err.type || err);
  destroyPeer();
  clearTimeout(S.retryTimer);
  const delay = Math.min(1500 + n * 800, 5000);
  S.retryTimer = setTimeout(() => attemptConnect(n + 1), delay);
}

function setupConn(conn) {
  S.conn = conn;
  conn.on("open", () => send({ t: "hello", name: S.myName }));
  conn.on("data", onMessage);
  conn.on("close", onPeerGone);
  conn.on("error", (e) => console.warn("conn error", e));
}

function wireCall(call) {
  call.on("stream", (remoteStream) => {
    $("remote-video").srcObject = remoteStream;
    enterCall();
  });
  call.on("close", onPeerGone);
  call.on("error", (e) => console.warn("call error", e));
}

function enterCall() {
  if (S.inCall) return;
  S.inCall = true;
  clearTimeout(S.watchdogTimer);
  clearTimeout(S.retryTimer);
  resetHangupState();
  $("local-name").textContent = S.myName;
  $("remote-name").textContent = S.remoteName || t("friend");
  switchView("view-call");
}

// Other side vanished (closed tab, lost network) — auto-reconnect.
function onPeerGone() {
  if (S.closing) return;
  if (S.myEndPressed && S.theirEndPressed) return; // normal goodbye
  if (!S.inCall) return; // pre-call churn is handled by the retry loop
  S.inCall = false;
  endGame();
  resetHangupState();
  $("remote-video").srcObject = null;
  toast(t("reconnecting"), 3500);
  switchView("view-wait");
  $("wait-status").textContent = t("reconnecting");
  scheduleRetry(0);
}

function send(obj) {
  if (S.conn && S.conn.open) S.conn.send(obj);
}

// ---------- messages ----------
function onMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.t) {
    case "hello":
      S.remoteName = String(msg.name || "").slice(0, 14);
      $("remote-name").textContent = S.remoteName;
      break;
    case "hangup":
      onHangupMsg(msg);
      break;
    case "game":
      onGameMsg(msg);
      break;
    default:
      if (S.currentGame && S.currentGame.onMessage) S.currentGame.onMessage(msg);
  }
}

// ---------- mic / cam toggles ----------
$("btn-mic").onclick = () => {
  const track = S.localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $("btn-mic").classList.toggle("off", !track.enabled);
  $("btn-mic").textContent = track.enabled ? "🎤" : "🔇";
};
$("btn-cam").onclick = () => {
  const track = S.localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $("btn-cam").classList.toggle("off", !track.enabled);
};

// ---------- hang up together ----------
$("btn-end").onclick = () => {
  if (S.myEndPressed) return;
  S.myEndPressed = true;
  send({ t: "hangup", a: "press" });
  refreshHangupUI();
  maybeFinishHangup();
};

$("btn-hangup-cancel").onclick = () => {
  S.myEndPressed = false;
  send({ t: "hangup", a: "cancel" });
  refreshHangupUI();
  toast(t("hangupCancelled"));
};

function onHangupMsg(msg) {
  if (msg.a === "press") {
    S.theirEndPressed = true;
    refreshHangupUI();
    maybeFinishHangup();
  } else if (msg.a === "cancel") {
    S.theirEndPressed = false;
    refreshHangupUI();
  }
}

function resetHangupState() {
  S.myEndPressed = false;
  S.theirEndPressed = false;
  clearTimeout(S.hangupTimer);
  hide($("hangup-banner"));
  hide($("hangup-wait"));
  $("btn-end").classList.remove("pulse");
}

function refreshHangupUI() {
  const banner = $("hangup-banner");
  const waitBox = $("hangup-wait");
  const endBtn = $("btn-end");

  if (S.theirEndPressed && !S.myEndPressed) {
    $("hangup-banner-text").textContent = t("theyWantHangup", S.remoteName || t("friend"));
    show(banner);
    endBtn.classList.add("pulse");
  } else {
    hide(banner);
    endBtn.classList.remove("pulse");
  }

  if (S.myEndPressed && !S.theirEndPressed) {
    $("hangup-wait-text").textContent = t("waitingHangup", S.remoteName || t("friend"));
    show(waitBox);
    clearTimeout(S.hangupTimer);
    S.hangupTimer = setTimeout(() => {
      if (S.myEndPressed && !S.theirEndPressed) $("btn-hangup-cancel").click();
    }, 25000);
  } else {
    hide(waitBox);
    clearTimeout(S.hangupTimer);
  }
}

function maybeFinishHangup() {
  if (!(S.myEndPressed && S.theirEndPressed)) return;
  switchView("view-bye");
  setTimeout(() => cleanup(false), 400);
}

function cleanup(goHome) {
  S.closing = true;
  clearTimeout(S.retryTimer);
  clearTimeout(S.watchdogTimer);
  destroyPeer();
  try { S.localStream && S.localStream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
  $("remote-video").srcObject = null;
  $("local-video").srcObject = null;
  Object.assign(S, {
    localStream: null, inCall: false, currentGame: null, remoteName: "",
  });
  resetHangupState();
  document.body.classList.remove("in-game");
  $("game-area").innerHTML = "";
  hide($("games-drawer"));
  if (goHome) switchView("view-home");
}

// ---------- game framework ----------
const GAMES = [];
window.JUNTOS = { GAMES, S, send, t, toast, $, snapshot, endGame, launchGame, langRef: () => lang };

$("btn-games").onclick = () => {
  buildGamesGrid();
  show($("games-drawer"));
};
$("btn-close-drawer").onclick = () => hide($("games-drawer"));

function buildGamesGrid() {
  const grid = $("games-grid");
  grid.innerHTML = "";
  GAMES.forEach((g) => {
    const b = document.createElement("button");
    b.className = "game-tile";
    b.style.background = g.color;
    b.innerHTML = `<span class="g-emoji">${g.emoji}</span><span>${g.name[lang]}</span>`;
    b.onclick = () => {
      hide($("games-drawer"));
      launchGame(g.id, true);
    };
    grid.appendChild(b);
  });
}

function launchGame(id, iAmInitiator, payload) {
  const g = GAMES.find((x) => x.id === id);
  if (!g) return;
  if (S.currentGame && S.currentGame.destroy) S.currentGame.destroy();

  if (iAmInitiator) {
    payload = payload || (g.makePayload ? g.makePayload() : {});
    send({ t: "game", a: "start", id, payload });
  }
  document.body.classList.add("in-game");
  const area = $("game-area");
  area.innerHTML = "";

  const quit = document.createElement("button");
  quit.className = "game-quit";
  quit.textContent = "✖";
  quit.title = t("quitGame");
  quit.onclick = () => {
    send({ t: "game", a: "quit" });
    endGame();
  };
  area.appendChild(quit);

  const card = document.createElement("div");
  card.className = "game-card";
  area.appendChild(card);

  S.currentGame = g.start(card, payload || {}, iAmInitiator) || {};
  S.currentGame._id = id;
}

function onGameMsg(msg) {
  if (msg.a === "start") launchGame(msg.id, false, msg.payload);
  else if (msg.a === "quit") endGame();
}

function endGame() {
  if (S.currentGame && S.currentGame.destroy) S.currentGame.destroy();
  S.currentGame = null;
  document.body.classList.remove("in-game");
  $("game-area").innerHTML = "";
}

// ---------- shared snapshot helper ----------
function snapshot(which) {
  const video = $(which === "remote" ? "remote-video" : "local-video");
  const w = 480;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const h = Math.round((vh / vw) * w);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (which === "local") {
    ctx.translate(w, 0); ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.7);
}
