/* ============================================================
   Juntos 📞 — games
   Every game registers itself in JUNTOS.GAMES with:
   { id, emoji, name:{es,en}, color,
     makePayload()  -> object sent to the other side on start,
     start(cardEl, payload, iAmInitiator) -> {onMessage(msg), destroy()} }
   Game-to-game messages use t:"g:<gameId>".
   ============================================================ */
(() => {
  const { GAMES, S, send, toast, snapshot, endGame } = window.JUNTOS;
  const L = () => window.JUNTOS.langRef();
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const TXT = (es, en) => (L() === "es" ? es : en);

  /* ---------- shared paint canvas ----------
     Draws on a canvas (optionally over a background image).
     onStroke(points, color, size) fires with normalized coords for live sync. */
  function makePainter(canvas, bgImage, onStroke) {
    const ctx = canvas.getContext("2d");
    const strokes = []; // {pts:[{x,y}..], color, size} normalized 0..1
    let cur = null;
    let color = "#FF3B3B", size = 6;

    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
      else { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      for (const s of strokes) drawStroke(s);
      if (cur) drawStroke(cur);
    }
    function drawStroke(s) {
      if (s.pts.length === 0) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size * (canvas.width / 480);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x * canvas.width, s.pts[0].y * canvas.height);
      if (s.pts.length === 1) ctx.lineTo(s.pts[0].x * canvas.width + 0.1, s.pts[0].y * canvas.height);
      for (let i = 1; i < s.pts.length; i++)
        ctx.lineTo(s.pts[i].x * canvas.width, s.pts[i].y * canvas.height);
      ctx.stroke();
    }
    function norm(ev) {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
      };
    }
    let pending = [];
    let flushTm = null;
    function flush() {
      if (pending.length && onStroke) onStroke(pending, color, size, false);
      pending = [];
      flushTm = null;
    }
    canvas.addEventListener("pointerdown", (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      cur = { pts: [norm(ev)], color, size };
      pending = [cur.pts[0]];
      if (onStroke) onStroke(pending, color, size, true); // true = new stroke
      pending = [];
      redraw();
      ev.preventDefault();
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!cur) return;
      const p = norm(ev);
      cur.pts.push(p);
      pending.push(p);
      if (!flushTm) flushTm = setTimeout(flush, 50);
      redraw();
      ev.preventDefault();
    });
    const up = () => {
      if (!cur) return;
      flush();
      strokes.push(cur);
      cur = null;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    redraw();
    return {
      setColor: (c) => (color = c),
      setSize: (s) => (size = s),
      undo: () => { strokes.pop(); redraw(); },
      clear: () => { strokes.length = 0; redraw(); },
      // remote drawing support
      remoteStroke(pts, c, s, isNew) {
        if (isNew || !this._lastRemote) {
          this._lastRemote = { pts: [...pts], color: c, size: s };
          strokes.push(this._lastRemote);
        } else {
          this._lastRemote.pts.push(...pts);
        }
        redraw();
      },
      toDataURL: () => canvas.toDataURL("image/jpeg", 0.7),
    };
  }

  function paintToolbar(painter, colors) {
    const bar = el("div", "paint-tools");
    const swatches = [];
    (colors || ["#FF3B3B", "#FF9D3C", "#FFE23C", "#3ED598", "#19C3D4", "#7B5CFF", "#FF7BAC", "#1B1B1B", "#FFFFFF"]).forEach((c, i) => {
      const s = el("button", "swatch" + (i === 0 ? " sel" : ""));
      s.style.background = c;
      s.onclick = () => {
        painter.setColor(c);
        swatches.forEach((x) => x.classList.remove("sel"));
        s.classList.add("sel");
      };
      swatches.push(s);
      bar.appendChild(s);
    });
    [[4, 10], [8, 16], [16, 24]].forEach(([sz, px], i) => {
      const b = el("button", "tool-btn");
      b.innerHTML = `<span class="size-dot" style="width:${px}px;height:${px}px"></span>`;
      if (i === 1) painter.setSize(8);
      b.onclick = () => painter.setSize(sz);
      bar.appendChild(b);
    });
    const undo = el("button", "tool-btn", "↩️");
    undo.onclick = () => painter.undo();
    bar.appendChild(undo);
    return bar;
  }

  const againQuitRow = (onAgain) => {
    const row = el("div", "photo-row");
    if (onAgain) {
      const again = el("button", "btn btn-green", `🔁 ${TXT("Otra vez", "Again")}`);
      again.onclick = onAgain;
      row.appendChild(again);
    }
    const quit = el("button", "btn btn-ghost", TXT("Salir", "Leave"));
    quit.onclick = () => { send({ t: "game", a: "quit" }); endGame(); };
    row.appendChild(quit);
    return row;
  };

  /* ============================================================
     1) FACE DOODLE — snapshot the OTHER person, turn them into
        a pirate/cat/alien..., then swap masterpieces. */
  const DOODLE_PROMPTS = [
    ["pirata", "a pirate", "🏴‍☠️"], ["gato", "a cat", "🐱"], ["superhéroe", "a superhero", "🦸"],
    ["alien", "an alien", "👽"], ["payaso", "a clown", "🤡"], ["rey o reina", "a king or queen", "👑"],
    ["robot", "a robot", "🤖"], ["monstruo", "a monster", "👹"], ["abuelito", "a grandpa", "👴"],
    ["mago", "a wizard", "🧙"], ["vampiro", "a vampire", "🧛"], ["unicornio", "a unicorn", "🦄"],
  ];
  GAMES.push({
    id: "doodle",
    emoji: "🎨",
    color: "#FF7BAC",
    name: { es: "Píntame la cara", en: "Doodle my face" },
    makePayload: () => ({ p: Math.floor(Math.random() * DOODLE_PROMPTS.length) }),
    start(card, payload) {
      const [es, en, pe] = DOODLE_PROMPTS[payload.p || 0];
      let theirImage = null, myDone = false, revealed = false;

      card.appendChild(el("h3", "game-title", `🎨 ${TXT("¡Píntame la cara!", "Doodle my face!")}`));
      card.appendChild(el("p", "game-sub",
        TXT(`Convierte a <b>${S.remoteName}</b> en <b>${es.toUpperCase()}</b> ${pe}`,
            `Turn <b>${S.remoteName}</b> into <b>${en.toUpperCase()}</b> ${pe}`)));

      const canvas = el("canvas", "paint-canvas");
      canvas.width = 480; canvas.height = 360;
      card.appendChild(canvas);

      const img = new Image();
      img.src = snapshot("remote");
      const painter = makePainter(canvas, img);
      img.onload = () => painter.clear(); // redraw once the photo is ready

      card.appendChild(paintToolbar(painter));

      const done = el("button", "btn btn-big btn-green", `✅ ${TXT("¡Listo!", "Done!")}`);
      done.onclick = () => {
        myDone = true;
        done.disabled = true;
        done.textContent = TXT("Esperando el dibujo del otro… 🕐", "Waiting for the other drawing… 🕐");
        send({ t: "g:doodle", img: painter.toDataURL() });
        maybeReveal();
      };
      card.appendChild(done);

      function maybeReveal() {
        if (revealed || !myDone || !theirImage) return;
        revealed = true;
        const mine = painter.toDataURL();
        card.innerHTML = "";
        card.appendChild(el("h3", "game-title", `😂 ${TXT("¡Mirad qué obras de arte!", "Look at these masterpieces!")}`));
        const row = el("div", "photo-row");
        const a = el("figure", "photo-card",
          `<img src="${mine}"><figcaption>${TXT(`${S.remoteName} de ${es}`, `${S.remoteName} as ${en}`)}</figcaption>`);
        const b = el("figure", "photo-card",
          `<img src="${theirImage}"><figcaption>${TXT(`¡Tú de ${es}!`, `You as ${en}!`)}</figcaption>`);
        row.appendChild(a); row.appendChild(b);
        card.appendChild(row);
        card.appendChild(againQuitRow(() => window.JUNTOS.launchGame("doodle", true)));
      }

      return {
        onMessage(msg) {
          if (msg.t === "g:doodle" && msg.img) { theirImage = msg.img; maybeReveal(); }
        },
      };
    },
  });

  /* ============================================================
     2) COPY THE FACE — same emoji on both screens, 3-2-1, photo! */
  const FACES = ["😜", "😱", "🥸", "😡", "🥺", "🤪", "😴", "🤠", "😍", "🐵", "😎", "🤢", "👻", "🦁"];
  GAMES.push({
    id: "faces",
    emoji: "📸",
    color: "#19C3D4",
    name: { es: "Pon la cara", en: "Make the face" },
    makePayload: () => ({ e: pick(FACES) }),
    start(card, payload) {
      const emoji = payload.e || "😜";
      let theirPhoto = null, myPhoto = null;
      let cancelled = false;

      card.appendChild(el("h3", "game-title", `📸 ${TXT("¡Pon esta cara!", "Make this face!")}`));
      const big = el("div", "big-emoji", emoji);
      card.appendChild(big);
      const count = el("div", "big-count", "3");
      card.appendChild(count);

      let n = 3;
      const iv = setInterval(() => {
        n--;
        if (cancelled) return clearInterval(iv);
        if (n > 0) count.textContent = String(n);
        else {
          clearInterval(iv);
          count.textContent = "📸";
          myPhoto = snapshot("local");
          send({ t: "g:faces", img: myPhoto });
          maybeReveal();
        }
      }, 900);

      function maybeReveal() {
        if (!myPhoto || !theirPhoto) {
          if (myPhoto) count.textContent = "🕐";
          return;
        }
        card.innerHTML = "";
        card.appendChild(el("h3", "game-title", `${emoji} ${TXT("¡Así habéis quedado!", "Here's how you did!")}`));
        const row = el("div", "photo-row");
        row.appendChild(el("figure", "photo-card", `<img src="${myPhoto}"><figcaption>${S.myName}</figcaption>`));
        row.appendChild(el("figure", "photo-card", `<img src="${theirPhoto}"><figcaption>${S.remoteName}</figcaption>`));
        card.appendChild(row);
        card.appendChild(againQuitRow(() => window.JUNTOS.launchGame("faces", true)));
      }

      return {
        onMessage(msg) {
          if (msg.t === "g:faces" && msg.img) { theirPhoto = msg.img; maybeReveal(); }
        },
        destroy() { cancelled = true; clearInterval(iv); },
      };
    },
  });

  /* ============================================================
     3) TIC-TAC-TOE — initiator is ❌ and starts. */
  GAMES.push({
    id: "ttt",
    emoji: "⭕",
    color: "#FFB332",
    name: { es: "Tres en raya", en: "Tic-tac-toe" },
    makePayload: () => ({}),
    start(card, payload, iAmInitiator) {
      const ME = iAmInitiator ? "❌" : "⭕";
      const THEM = iAmInitiator ? "⭕" : "❌";
      let board = Array(9).fill("");
      let myTurn = iAmInitiator;
      let over = false;

      card.appendChild(el("h3", "game-title", `${ME} ${TXT("Tres en raya", "Tic-tac-toe")}`));
      const status = el("p", "game-sub", "");
      card.appendChild(status);
      const grid = el("div", "ttt-board");
      card.appendChild(grid);
      const cells = [];
      for (let i = 0; i < 9; i++) {
        const c = el("button", "ttt-cell", "");
        c.onclick = () => play(i, true);
        cells.push(c);
        grid.appendChild(c);
      }
      const restart = el("button", "btn btn-green hidden", `🔁 ${TXT("Otra partida", "New game")}`);
      restart.onclick = () => { send({ t: "g:ttt", a: "restart" }); reset(!myTurnStart); };
      card.appendChild(restart);
      let myTurnStart = iAmInitiator;

      function refresh() {
        board.forEach((v, i) => {
          cells[i].textContent = v;
          cells[i].classList.toggle("x", v === "❌");
          cells[i].classList.toggle("o", v === "⭕");
        });
        status.textContent = over ? status.textContent
          : myTurn ? TXT("¡Te toca! 🫵", "Your turn! 🫵")
                   : TXT(`Le toca a ${S.remoteName}… 🕐`, `${S.remoteName}'s turn… 🕐`);
      }
      function play(i, mine) {
        if (over || board[i]) return;
        if (mine && !myTurn) return;
        board[i] = mine ? ME : THEM;
        if (mine) send({ t: "g:ttt", a: "move", i });
        myTurn = !mine ? true : false;
        checkEnd();
        refresh();
      }
      function checkEnd() {
        const W = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
        for (const [a, b, c] of W) {
          if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            over = true;
            [a, b, c].forEach((k) => cells[k].classList.add("win"));
            status.textContent = board[a] === ME
              ? TXT("¡Has ganado! 🏆🎉", "You win! 🏆🎉")
              : TXT(`¡Gana ${S.remoteName}! 👏`, `${S.remoteName} wins! 👏`);
            restart.classList.remove("hidden");
            return;
          }
        }
        if (board.every(Boolean)) {
          over = true;
          status.textContent = TXT("¡Empate! 🤝", "It's a tie! 🤝");
          restart.classList.remove("hidden");
        }
      }
      function reset(iStart) {
        board = Array(9).fill("");
        over = false;
        myTurnStart = iStart;
        myTurn = iStart;
        cells.forEach((c) => c.classList.remove("win"));
        restart.classList.add("hidden");
        refresh();
      }
      refresh();

      return {
        onMessage(msg) {
          if (msg.t !== "g:ttt") return;
          if (msg.a === "move") play(msg.i, false);
          if (msg.a === "restart") reset(!myTurnStart);
        },
      };
    },
  });

  /* ============================================================
     4) ROCK PAPER SCISSORS — countdown, pick, reveal, score. */
  GAMES.push({
    id: "rps",
    emoji: "✂️",
    color: "#3ED598",
    name: { es: "Piedra, papel, tijera", en: "Rock, paper, scissors" },
    makePayload: () => ({}),
    start(card) {
      let myPick = null, theirPick = null, score = [0, 0], locked = false;
      const BEATS = { "✊": "✌️", "✋": "✊", "✌️": "✋" };

      card.appendChild(el("h3", "game-title", `✊✋✌️ ${TXT("Piedra, papel, tijera", "Rock, paper, scissors")}`));
      const scoreEl = el("div", "score-line", "");
      card.appendChild(scoreEl);
      const status = el("p", "game-sub", TXT("¡Elige!", "Pick one!"));
      card.appendChild(status);
      const reveal = el("div", "big-emoji hidden", "");
      card.appendChild(reveal);
      const row = el("div", "rps-row");
      card.appendChild(row);
      const btns = {};
      ["✊", "✋", "✌️"].forEach((h) => {
        const b = el("button", "rps-btn", h);
        b.onclick = () => {
          if (locked) return;
          myPick = h;
          Object.values(btns).forEach((x) => x.classList.remove("sel"));
          b.classList.add("sel");
          send({ t: "g:rps", a: "pick", h });
          status.textContent = theirPick ? "" : TXT(`Esperando a ${S.remoteName}… 🕐`, `Waiting for ${S.remoteName}… 🕐`);
          maybeReveal();
        };
        btns[h] = b;
        row.appendChild(b);
      });
      const next = el("button", "btn btn-green hidden", `🔁 ${TXT("Otra ronda", "Next round")}`);
      next.onclick = () => { send({ t: "g:rps", a: "next" }); resetRound(); };
      card.appendChild(next);
      updateScore();

      function updateScore() {
        scoreEl.textContent = `${S.myName} ${score[0]} — ${score[1]} ${S.remoteName}`;
      }
      function maybeReveal() {
        if (!myPick || !theirPick) return;
        locked = true;
        reveal.classList.remove("hidden");
        reveal.textContent = `${myPick} 🆚 ${theirPick}`;
        if (myPick === theirPick) status.textContent = TXT("¡Empate! 😄", "Tie! 😄");
        else if (BEATS[myPick] === theirPick) { score[0]++; status.textContent = TXT("¡Punto para ti! 🎉", "Point for you! 🎉"); }
        else { score[1]++; status.textContent = TXT(`¡Punto para ${S.remoteName}! 👏`, `Point for ${S.remoteName}! 👏`); }
        updateScore();
        next.classList.remove("hidden");
      }
      function resetRound() {
        myPick = theirPick = null;
        locked = false;
        reveal.classList.add("hidden");
        next.classList.add("hidden");
        Object.values(btns).forEach((x) => x.classList.remove("sel"));
        status.textContent = TXT("¡Elige!", "Pick one!");
      }

      return {
        onMessage(msg) {
          if (msg.t !== "g:rps") return;
          if (msg.a === "pick") { theirPick = msg.h; maybeReveal(); }
          if (msg.a === "next") resetRound();
        },
      };
    },
  });

  /* ============================================================
     5) DRAW & GUESS — one draws live, the other picks from 4. */
  const DG_WORDS = [
    ["perro", "dog"], ["casa", "house"], ["sol", "sun"], ["coche", "car"], ["árbol", "tree"],
    ["pez", "fish"], ["pizza", "pizza"], ["cohete", "rocket"], ["dragón", "dragon"], ["helado", "ice cream"],
    ["gato", "cat"], ["luna", "moon"], ["flor", "flower"], ["barco", "boat"], ["araña", "spider"],
    ["plátano", "banana"], ["fantasma", "ghost"], ["castillo", "castle"], ["robot", "robot"], ["tarta", "cake"],
  ];
  GAMES.push({
    id: "dg",
    emoji: "✏️",
    color: "#7B5CFF",
    name: { es: "Dibuja y adivina", en: "Draw & guess" },
    makePayload: () => {
      // secret word + 3 decoys, initiator draws
      const idxs = new Set([Math.floor(Math.random() * DG_WORDS.length)]);
      while (idxs.size < 4) idxs.add(Math.floor(Math.random() * DG_WORDS.length));
      const options = [...idxs].sort(() => Math.random() - 0.5);
      return { secret: [...idxs][0], options };
    },
    start(card, payload, iAmInitiator) {
      const secretIdx = payload.secret;
      const options = payload.options || [secretIdx];
      const word = DG_WORDS[secretIdx];
      let solved = false;

      const canvas = el("canvas", "paint-canvas");
      canvas.width = 480; canvas.height = 360;

      if (iAmInitiator) {
        // ----- drawer -----
        card.appendChild(el("h3", "game-title", `✏️ ${TXT("¡Dibuja esto!", "Draw this!")}`));
        card.appendChild(el("p", "game-sub",
          TXT(`Palabra secreta: <b>${word[0].toUpperCase()}</b> 🤫 ¡No la digas!`,
              `Secret word: <b>${word[1].toUpperCase()}</b> 🤫 Don't say it!`)));
        card.appendChild(canvas);
        const painter = makePainter(canvas, null, (pts, color, size, isNew) => {
          send({ t: "g:dg", a: "stroke", pts, color, size, n: isNew });
        });
        card.appendChild(paintToolbar(painter));
        const clr = el("button", "tool-btn", `🗑 ${TXT("Borrar todo", "Clear")}`);
        clr.onclick = () => { painter.clear(); send({ t: "g:dg", a: "clear" }); };
        card.appendChild(clr);
        const status = el("p", "game-sub", TXT(`${S.remoteName} está adivinando… 👀`, `${S.remoteName} is guessing… 👀`));
        card.appendChild(status);

        return {
          onMessage(msg) {
            if (msg.t !== "g:dg") return;
            if (msg.a === "guess") {
              const right = msg.i === secretIdx;
              status.innerHTML = right
                ? TXT(`🎉 ¡${S.remoteName} lo ha adivinado!`, `🎉 ${S.remoteName} got it!`)
                : TXT(`❌ Ha dicho "${DG_WORDS[msg.i][0]}"… ¡sigue dibujando!`, `❌ They said "${DG_WORDS[msg.i][1]}"… keep drawing!`);
              if (right && !solved) {
                solved = true;
                card.appendChild(againQuitRow(() => window.JUNTOS.launchGame("dg", true)));
              }
            }
          },
        };
      } else {
        // ----- guesser -----
        card.appendChild(el("h3", "game-title", `👀 ${TXT("¿Qué está dibujando?", "What are they drawing?")}`));
        card.appendChild(canvas);
        const painter = makePainter(canvas, null); // local painter used only to render remote strokes
        canvas.style.pointerEvents = "none";
        const opts = el("div", "dg-opts");
        card.appendChild(opts);
        options.forEach((i) => {
          const b = el("button", "dg-opt", L() === "es" ? DG_WORDS[i][0] : DG_WORDS[i][1]);
          b.onclick = () => {
            if (solved) return;
            send({ t: "g:dg", a: "guess", i });
            if (i === secretIdx) {
              solved = true;
              b.classList.add("right");
              toast(TXT("¡Lo has adivinado! 🎉", "You got it! 🎉"));
            } else {
              b.classList.add("wrong");
              b.disabled = true;
            }
          };
          opts.appendChild(b);
        });

        return {
          onMessage(msg) {
            if (msg.t !== "g:dg") return;
            if (msg.a === "stroke") painter.remoteStroke(msg.pts, msg.color, msg.size, msg.n);
            if (msg.a === "clear") painter.clear();
          },
        };
      }
    },
  });

  /* ============================================================
     6) WOULD YOU RATHER — silly kid questions, both answer. */
  const WYR = [
    [["Volar como un pájaro 🐦", "Nadar como un pez 🐟"], ["Fly like a bird 🐦", "Swim like a fish 🐟"]],
    [["Comer solo pizza un año 🍕", "Comer solo helado un año 🍦"], ["Eat only pizza for a year 🍕", "Eat only ice cream for a year 🍦"]],
    [["Tener un dragón pequeño 🐉", "Tener un dinosaurio pequeño 🦕"], ["Have a tiny dragon 🐉", "Have a tiny dinosaur 🦕"]],
    [["Ser invisible 👻", "Ser súper fuerte 💪"], ["Be invisible 👻", "Be super strong 💪"]],
    [["Hablar con los animales 🐶", "Hablar todos los idiomas 🌍"], ["Talk to animals 🐶", "Speak every language 🌍"]],
    [["Vivir en un castillo 🏰", "Vivir en una nave espacial 🚀"], ["Live in a castle 🏰", "Live on a spaceship 🚀"]],
    [["Pelo azul para siempre 💙", "Pelo verde para siempre 💚"], ["Blue hair forever 💙", "Green hair forever 💚"]],
    [["Un pulpo de mascota 🐙", "Un pingüino de mascota 🐧"], ["A pet octopus 🐙", "A pet penguin 🐧"]],
    [["Saltar súper alto 🦘", "Correr súper rápido ⚡"], ["Jump super high 🦘", "Run super fast ⚡"]],
    [["Desayunar tarta cada día 🎂", "Cenar chuches cada día 🍬"], ["Cake for breakfast every day 🎂", "Sweets for dinner every day 🍬"]],
    [["Que llueva zumo 🧃", "Que nieve palomitas 🍿"], ["Rain that's juice 🧃", "Snow that's popcorn 🍿"]],
    [["Ser un superhéroe 🦸", "Ser un mago 🧙"], ["Be a superhero 🦸", "Be a wizard 🧙"]],
  ];
  GAMES.push({
    id: "wyr",
    emoji: "🤔",
    color: "#FFE23C",
    name: { es: "¿Qué prefieres?", en: "Would you rather?" },
    makePayload: () => ({ q: Math.floor(Math.random() * WYR.length) }),
    start(card, payload) {
      let qIdx = payload.q || 0;
      let myPick = null, theirPick = null;

      card.appendChild(el("h3", "game-title", `🤔 ${TXT("¿Qué prefieres?", "Would you rather?")}`));
      const status = el("p", "game-sub", TXT("¡Elige tu favorito!", "Pick your favourite!"));
      card.appendChild(status);
      const opts = el("div", "wyr-opts");
      card.appendChild(opts);
      const next = el("button", "btn btn-green hidden", `➡️ ${TXT("Otra pregunta", "Next question")}`);
      next.onclick = () => {
        const q = Math.floor(Math.random() * WYR.length);
        send({ t: "g:wyr", a: "q", q });
        loadQ(q);
      };
      card.appendChild(next);

      function loadQ(q) {
        qIdx = q;
        myPick = theirPick = null;
        next.classList.add("hidden");
        status.textContent = TXT("¡Elige tu favorito!", "Pick your favourite!");
        opts.innerHTML = "";
        const pair = WYR[qIdx][L() === "es" ? 0 : 1];
        pair.forEach((txt, i) => {
          const b = el("button", `wyr-btn ${i === 0 ? "a" : "b"}`, txt);
          b.onclick = () => {
            if (myPick !== null) return;
            myPick = i;
            b.classList.add("sel");
            send({ t: "g:wyr", a: "pick", i });
            maybeReveal();
          };
          opts.appendChild(b);
        });
      }
      function maybeReveal() {
        if (myPick === null || theirPick === null) {
          if (myPick !== null) status.textContent = TXT(`Esperando a ${S.remoteName}… 🕐`, `Waiting for ${S.remoteName}… 🕐`);
          return;
        }
        status.textContent = myPick === theirPick
          ? TXT("¡Habéis elegido lo mismo! 🎉🎉", "You picked the same! 🎉🎉")
          : TXT("¡Habéis elegido distinto! 😄", "You picked differently! 😄");
        [...opts.children].forEach((b, i) => {
          if (i === theirPick) b.innerHTML += ` &nbsp;⭐ ${S.remoteName}`;
          if (i === myPick) b.innerHTML += ` &nbsp;💛 ${S.myName}`;
        });
        next.classList.remove("hidden");
      }
      loadQ(qIdx);

      return {
        onMessage(msg) {
          if (msg.t !== "g:wyr") return;
          if (msg.a === "pick") { theirPick = msg.i; maybeReveal(); }
          if (msg.a === "q") loadQ(msg.q);
        },
      };
    },
  });
})();
