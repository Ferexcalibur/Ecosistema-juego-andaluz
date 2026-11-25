(function (global) {
  const EcoGame = (global.EcoGame = global.EcoGame || {});

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    const box = $("toast-container");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3400);
  }

  function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
  }

  let lastSeenChatCount = 0;
  let lastPendingCardKey = null;
  let boardListenersBound = false;

  const VALID_TARGETS = {
    turn_rabbits: "plants",
    turn_lynx: "rabbits",
    turn_remains: "remains",
    turn_insects: "remains",
    turn_nutrients: "plants",
    turn_plants: "plants",
  };

  function bindBoardInteractions() {
    if (boardListenersBound) return;
    boardListenersBound = true;

    const getZoneKeyFromEl = (el) => {
      const sub = el.closest(".center-subzone");
      if (sub && sub.dataset.role) return sub.dataset.role;
      const z = el.closest(".zone[data-zone]");
      if (!z) return null;
      return z.dataset.zone === "center" ? "remains" : z.dataset.zone;
    };

    const board = $("ecosystem-board");

    board.addEventListener("click", (e) => {
      const state = EcoGame.room.state;
      if (!state || state.status !== "playing") return;
      const activeRole = EcoGame.engine.getActivePhaseRole(state.phase);
      if (!activeRole) return;
      if (!EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase)) {
        const owner = EcoGame.engine.getTurnOwner(state);
        if (owner) {
          showToast(
            owner.isBot
              ? `🤖 Turno automático de ${owner.name}...`
              : `⏳ Es el turno de ${owner.name}. Solo él/ella mueve sus fichas.`
          );
        }
        return;
      }

      const targetZone = getZoneKeyFromEl(e.target);
      if (!targetZone) return;
      EcoGame.sound.playPop();
      EcoGame.room.dispatchGameAction("PERFORM_MOVE", { targetZone, mode: "one" });
    });

    // Drag-and-drop también disponible además de clic directo
    board.addEventListener("dragstart", (e) => {
      const chip = e.target.closest(".token-chip[data-role]");
      if (!chip) return;
      e.dataTransfer.setData("text/plain", chip.dataset.role);
    });

    board.addEventListener("dragover", (e) => {
      const state = EcoGame.room.state;
      if (!state || !EcoGame.engine.getActivePhaseRole(state.phase)) return;
      e.preventDefault();
    });

    board.addEventListener("drop", (e) => {
      e.preventDefault();
      const state = EcoGame.room.state;
      if (!state || state.status !== "playing") return;
      if (!EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase)) return;
      const targetZone = getZoneKeyFromEl(e.target);
      if (!targetZone) return;
      EcoGame.sound.playPop();
      EcoGame.room.dispatchGameAction("PERFORM_MOVE", { targetZone, mode: "one" });
    });
  }

  function shakeZone(zoneKey) {
    if (!zoneKey) return;
    const el =
      zoneKey === "insects" || zoneKey === "remains"
        ? $(`subzone-${zoneKey}`)
        : document.querySelector(`.zone[data-zone="${zoneKey}"]`);
    if (!el) return;
    el.classList.remove("zone-shake");
    void el.offsetWidth;
    el.classList.add("zone-shake");
  }

  function renderTokens(containerId, count, cssClass, emoji, roleKey, isMyTurn, emojisPool = null) {
    const el = $(containerId);
    el.innerHTML = "";
    const capped = Math.min(count, 28);
    for (let i = 0; i < capped; i++) {
      const chip = document.createElement("span");
      chip.className = `token-chip ${cssClass} ${isMyTurn ? "token-draggable" : ""}`;
      chip.textContent = emojisPool ? emojisPool[i % emojisPool.length] : emoji;
      chip.dataset.role = roleKey;
      chip.draggable = isMyTurn;
      el.appendChild(chip);
    }
    if (count > 28) {
      const extra = document.createElement("span");
      extra.className = "mini-pill pill-yellow";
      extra.textContent = `+${count - 28}`;
      el.appendChild(extra);
    }
  }

  function renderLobby(state) {
    showScreen("screen-lobby");
    const eco = EcoGame.ECOSYSTEMS[state.ecosystem] || EcoGame.ECOSYSTEMS.donana;
    $("lobby-eco-badge").textContent = eco.name;
    $("lobby-variant-badge").textContent =
      state.variant === "balanced" ? "Equilibrio Sostenible" : "Reglas Clásicas (PDF)";
    $("lobby-code-text").textContent = state.roomCode || "LOCAL";

    $("topbar-room-pill").classList.remove("hidden");
    $("topbar-room-code").textContent = state.roomCode || "LOCAL";

    const me = EcoGame.room.getMyPlayer();
    const myRole = me ? me.role : null;

    const rolesGrid = $("lobby-roles-grid");
    rolesGrid.innerHTML = "";
    EcoGame.ROLES.forEach((role) => {
      const occupant = state.players.find((p) => !p.isBot && p.role === role.id);
      const isMine = myRole === role.id;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `role-btn ${isMine ? "selected" : ""}`;
      btn.innerHTML = `
        <div class="role-btn-title">
          <span>${role.emoji} ${role.name}</span>
          ${isMine ? "<span>✅</span>" : ""}
        </div>
        <div class="role-btn-desc">${role.desc}</div>
        ${
          occupant
            ? `<div class="role-occupant">Jugador: ${escapeHtml(occupant.name)}</div>`
            : `<div class="role-occupant muted">🤖 Se rellenará con Bot</div>`
        }
      `;
      btn.addEventListener("click", () => {
        EcoGame.sound.playPop();
        EcoGame.room.dispatch("SELECT_ROLE", { role: isMine ? null : role.id });
      });
      rolesGrid.appendChild(btn);
    });

    const pList = $("lobby-player-list");
    pList.innerHTML = "";
    const humans = state.players.filter((p) => !p.isBot);
    $("lobby-player-count").textContent = humans.length;
    humans.forEach((p) => {
      const roleObj = EcoGame.ROLES.find((r) => r.id === p.role);
      const li = document.createElement("li");
      li.className = "player-item";
      li.innerHTML = `
        <div class="player-meta">
          <span>${roleObj ? roleObj.emoji : "👤"}</span>
          <span>${escapeHtml(p.name)}</span>
          ${p.isHost ? '<span class="host-tag">Anfitrión</span>' : ""}
        </div>
        <span class="badge-pill badge-outline">${roleObj ? roleObj.name : "Sin ficha"}</span>
      `;
      pList.appendChild(li);
    });

    if (EcoGame.room.isHostOrLocal()) {
      $("btn-start-game").classList.remove("hidden");
      $("lobby-wait-msg").classList.add("hidden");
    } else {
      $("btn-start-game").classList.add("hidden");
      $("lobby-wait-msg").classList.remove("hidden");
    }

    renderChat($("lobby-chat-messages"), state.chat);
  }

  function renderChat(container, messages) {
    container.innerHTML = "";
    messages.forEach((m) => {
      const div = document.createElement("div");
      div.className = `chat-msg ${m.system ? "system" : ""}`;
      if (m.system) {
        div.textContent = m.text;
      } else {
        div.innerHTML = `<strong>${escapeHtml(m.author)}:</strong> ${escapeHtml(m.text)}`;
      }
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  }

  function renderChart(containerEl, history) {
    if (!history || history.length === 0) return;
    const width = 440;
    const height = 210;
    const padL = 32;
    const padR = 14;
    const padT = 14;
    const padB = 26;

    const series = [
      { key: "nutrients", color: "#8d5b32" },
      { key: "plants", color: "#2f9e44" },
      { key: "rabbits", color: "#4dabf7" },
      { key: "lynx", color: "#f76707" },
      { key: "insects", color: "#fab005" },
      { key: "remains", color: "#868e96" },
    ];

    let maxVal = 12;
    history.forEach((row) => {
      series.forEach((s) => {
        if ((row[s.key] || 0) > maxVal) maxVal = row[s.key];
      });
    });

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const n = history.length;

    const xAt = (idx) => (n === 1 ? padL + plotW / 2 : padL + (idx / (n - 1)) * plotW);
    const yAt = (val) => padT + plotH - (val / maxVal) * plotH;

    let gridLines = "";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = Math.round((maxVal * i) / steps);
      const y = yAt(v);
      gridLines += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#e3ece1" stroke-width="1" />`;
      gridLines += `<text x="${padL - 5}" y="${y + 4}" font-size="10" text-anchor="end" fill="#6b7b70">${v}</text>`;
    }

    let xLabels = "";
    history.forEach((row, idx) => {
      const x = xAt(idx);
      xLabels += `<text x="${x}" y="${height - 6}" font-size="10" text-anchor="middle" fill="#5c6f63">${escapeHtml(
        row.round === 0 ? "Ini" : "R" + row.round
      )}</text>`;
    });

    let paths = "";
    series.forEach((s) => {
      const pts = history.map((row, idx) => `${xAt(idx).toFixed(1)},${yAt(row[s.key] || 0).toFixed(1)}`);
      paths += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}" />`;
      history.forEach((row, idx) => {
        paths += `<circle cx="${xAt(idx).toFixed(1)}" cy="${yAt(row[s.key] || 0).toFixed(1)}" r="3.2" fill="${s.color}" />`;
      });
    });

    containerEl.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block;" role="img" aria-label="Gráfica de evolución de especies">
        ${gridLines}
        ${xLabels}
        ${paths}
      </svg>
    `;
  }

  function renderGame(state) {
    bindBoardInteractions();
    showScreen("screen-game");

    const eco = EcoGame.ECOSYSTEMS[state.ecosystem] || EcoGame.ECOSYSTEMS.donana;
    $("hud-round-num").textContent = `${state.round} / ${state.maxRounds}`;
    $("hud-eco-name").textContent = eco.name;

    const me = EcoGame.room.getMyPlayer();
    const myRoleObj = me && me.role ? EcoGame.ROLES.find((r) => r.id === me.role) : null;
    $("hud-my-role").textContent = state.controlAll
      ? "🎓 Modo Pizarra (todas las fichas)"
      : myRoleObj
      ? `Tu ficha: ${myRoleObj.emoji} ${myRoleObj.name}`
      : "Observador";

    if (state.roomCode) {
      $("topbar-room-pill").classList.remove("hidden");
      $("topbar-room-code").textContent = state.roomCode;
    } else {
      $("topbar-room-pill").classList.add("hidden");
    }

    // Stepper de fases
    const stepper = $("phase-stepper");
    stepper.innerHTML = "";
    const phaseIdx = EcoGame.PHASES.findIndex((p) => p.id === state.phase);
    EcoGame.PHASES.forEach((p, idx) => {
      if (p.id === "card" && state.round !== 3 && state.phase !== "card") return;
      const pill = document.createElement("span");
      pill.className = `step-pill ${idx < phaseIdx ? "done" : idx === phaseIdx ? "current" : ""}`;
      pill.textContent = p.short;
      stepper.appendChild(pill);
    });

    // Banner carta activa
    const banner = $("active-card-banner");
    if (state.activeCard) {
      banner.classList.remove("hidden");
      $("event-banner-icon").textContent = state.activeCard.emoji;
      $("event-banner-title").textContent = `Carta Ronda ${state.activeCard.drawnRound}: ${state.activeCard.title}`;
      $("event-banner-desc").textContent = state.activeCard.effectText;
      $("event-banner-badge").textContent =
        state.noInsectsRoundsLeft > 0
          ? `Sin insectos: ${state.noInsectsRoundsLeft} ronda(s)`
          : "Efecto aplicado";
    } else {
      banner.classList.add("hidden");
    }

    // Tablero 5 zonas (con 6 roles diferenciados)
    const b = state.board;
    $("count-nutrients").textContent = b.nutrients;
    $("count-plants").textContent = b.plants;
    $("count-rabbits").textContent = b.rabbits;
    $("count-lynx").textContent = b.lynx;
    $("count-insects").textContent = b.insects;
    $("count-remains").textContent = b.remains;

    const activeRole = EcoGame.engine.getActivePhaseRole(state.phase);
    const canAct = EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase);
    const targetZone = VALID_TARGETS[state.phase] || null;

    renderTokens("tokens-nutrients", b.nutrients, "token-nutrients", "🪱", "nutrients", canAct && activeRole === "nutrients");
    renderTokens("tokens-plants", b.plants, "token-plants", "🌱", "plants", canAct && activeRole === "plants");
    renderTokens("tokens-rabbits", b.rabbits, "token-rabbits", "🐇", "rabbits", canAct && activeRole === "rabbits");
    renderTokens("tokens-lynx", b.lynx, "token-lynx", "🐆", "lynx", canAct && activeRole === "lynx");
    renderTokens("tokens-insects", b.insects, "token-insects", "🐞", "insects", canAct && activeRole === "insects", EcoGame.SPECIES.insects.emojis);
    renderTokens("tokens-remains", b.remains, "token-remains", "🦴", "remains", canAct && activeRole === "remains");

    // Resaltado de propietario activo y objetivo válido
    const allZones = ["nutrients", "plants", "rabbits", "lynx", "insects", "remains"];
    allZones.forEach((roleId) => {
      const el =
        roleId === "insects" || roleId === "remains"
          ? $(`subzone-${roleId}`)
          : document.querySelector(`.zone[data-zone="${roleId}"]`);
      if (!el) return;
      el.classList.toggle("zone-owner-turn", activeRole === roleId);
      el.classList.toggle("zone-valid-target", canAct && targetZone === roleId);

      const owner = state.players.find((p) => p.role === roleId);
      const footerEl = $(`owner-${roleId}`);
      if (footerEl) {
        footerEl.textContent = owner
          ? `${owner.isBot ? "🤖 " : "👤 "}${owner.name}`
          : "Sin asignar";
      }
    });

    // Reserva
    const res = state.reserve;
    $("reserve-mode-label").textContent =
      state.variant === "balanced" ? "Variante equilibrio sostenible" : "Caja original del documento";
    $("reserve-items").innerHTML = `
      <span class="reserve-pill">🪱 Nutrientes: <strong>${res.nutrients}</strong></span>
      <span class="reserve-pill">🌱 Plantas: <strong>${res.plants}</strong></span>
      <span class="reserve-pill">🐇 Conejos: <strong>${res.rabbits}</strong></span>
      <span class="reserve-pill">🐆 Linces: <strong>${res.lynx}</strong></span>
      <span class="reserve-pill">🐞 Insectos: <strong>${res.insects}</strong></span>
      <span class="reserve-pill">🦴 Restos: <strong>${res.remains}</strong></span>
    `;

    // Panel de Acción Actual
    renderPhaseAction(state);

    // Modal carta pendiente
    const modalCard = $("modal-card");
    if (state.pendingCard) {
      const key = `${state.round}-${state.pendingCard.id}`;
      if (lastPendingCardKey !== key) {
        lastPendingCardKey = key;
        EcoGame.sound.playCard();
      }
      const c = state.pendingCard;
      $("card-reveal-box").innerHTML = `
        <h3>${escapeHtml(c.title)}</h3>
        <div class="card-emoji">${c.emoji}</div>
        <p><strong>${escapeHtml(c.effectText)}</strong></p>
        <p class="muted small">${escapeHtml(c.explain)}</p>
      `;
      $("btn-confirm-card").disabled = !EcoGame.room.canPlayerAct(EcoGame.room.myId, "card");
      modalCard.classList.remove("hidden");
    } else {
      modalCard.classList.add("hidden");
    }

    // Diario
    const logEl = $("game-log");
    logEl.innerHTML = "";
    state.logs.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.type === "warn" ? "log-warn" : item.type === "good" ? "log-good" : item.type === "card" ? "log-card" : "";
      li.textContent = item.round ? `[R${item.round}] ${item.text}` : item.text;
      logEl.appendChild(li);
    });

    // Tabla de registro + Gráfica
    const tbody = $("record-table-body");
    tbody.innerHTML = "";
    state.history.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(row.label)}</strong>${row.card ? " 🃏" : ""}</td>
        <td>${row.nutrients}</td>
        <td>${row.plants}</td>
        <td>${row.rabbits}</td>
        <td>${row.lynx}</td>
        <td>${row.insects}</td>
        <td>${row.remains}</td>
      `;
      tbody.appendChild(tr);
    });
    renderChart($("chart-container"), state.history);

    // Chat
    renderChat($("game-chat-messages"), state.chat);
    const chatTabActive = document.querySelector('.side-tab[data-tab="chat"]').classList.contains("active");
    if (chatTabActive) {
      lastSeenChatCount = state.chat.length;
      $("chat-badge").classList.add("hidden");
    } else if (state.chat.length > lastSeenChatCount) {
      $("chat-badge").textContent = state.chat.length - lastSeenChatCount;
      $("chat-badge").classList.remove("hidden");
    }
  }

  function renderPhaseAction(state) {
    const box = $("phase-action-card");
    const b = state.board;
    const m = state.roundMeta;
    const canAct = EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase);
    const turnOwner = EcoGame.engine.getTurnOwner(state);
    const activeRole = EcoGame.engine.getActivePhaseRole(state.phase);
    const activeRoleObj = EcoGame.ROLES.find((r) => r.id === activeRole);

    if (state.phase === "card") {
      box.innerHTML = `
        <span class="phase-badge">Inicio de Ronda ${state.round} · Carta del Ecosistema</span>
        <h3>🃏 ¡Robar carta especial!</h3>
        <p>En la Ronda 3 robamos una carta que altera el ecosistema para observar el efecto dominó.</p>
        <button id="btn-draw-card" class="btn btn-accent btn-lg full-width" ${canAct ? "" : "disabled"}>
          🎲 Robar Carta del Ecosistema
        </button>
      `;
      $("btn-draw-card").addEventListener("click", () => EcoGame.room.dispatchGameAction("DRAW_CARD"));
      return;
    }

    if (state.phase === "predict") {
      const myPred = state.predictions[EcoGame.room.myId]?.choice || null;
      const votes = Object.values(state.predictions);
      const predLabels = {
        up: "📈 Suben",
        stable: "⚖️ Igual",
        down: "📉 Bajan",
        collapse: "⚠️ Colapso",
      };
      box.innerHTML = `
        <span class="phase-badge">Ronda ${state.round} · Antes de mover fichas</span>
        <h3>🔮 ¿Qué creéis que pasará esta ronda?</h3>
        <div class="prediction-buttons">
          ${Object.entries(predLabels)
            .map(
              ([k, label]) =>
                `<button type="button" class="pred-btn ${myPred === k ? "selected" : ""}" data-pred="${k}">${label}</button>`
            )
            .join("")}
        </div>
        ${
          votes.length > 0
            ? `<div class="rule-preview">${votes
                .map((v) => `${escapeHtml(v.name)}: ${predLabels[v.choice]}`)
                .join(" · ")}</div>`
            : ""
        }
        <button id="btn-start-feed" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
          ➡️ Empezar Turnos (1º Conejos)
        </button>
      `;
      box.querySelectorAll(".pred-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          EcoGame.sound.playPop();
          EcoGame.room.dispatch("PREDICTION", { choice: btn.dataset.pred });
        });
      });
      $("btn-start-feed").addEventListener("click", () => {
        EcoGame.sound.playPop();
        EcoGame.room.dispatchGameAction("FINISH_PREDICT");
      });
      return;
    }

    if (activeRole) {
      const isBotTurn = turnOwner && turnOwner.isBot;
      const ownerLabel = turnOwner ? `${turnOwner.isBot ? "🤖 " : "👤 "}${escapeHtml(turnOwner.name)}` : "Encargado";

      let title = "";
      let instruction = "";
      let targetKey = VALID_TARGETS[state.phase];
      let actionBtnLabel = "⚡ Completar movimiento y pasar turno";

      if (state.phase === "turn_rabbits") {
        title = "🐇 Turno de Conejos";
        instruction = `<strong>Progreso:</strong> ${m.rabbitsMoved}/${b.rabbits} conejos movidos (2 🌱 por conejo).<br>👉 Haz clic en las <strong>Plantas (🌱)</strong> o arrastra un conejo allí. <em>Solo puedes comer plantas.</em>`;
        actionBtnLabel = "⚡ Alimentar todos y pasar a Lince";
      } else if (state.phase === "turn_lynx") {
        title = "🐆 Turno de Lince Ibérico";
        instruction = `<strong>Progreso:</strong> ${m.lynxMoved}/${b.lynx} lince(s) movidos (2 🐇 por lince).<br>👉 Haz clic en los <strong>Conejos (🐇)</strong> o arrastra el lince allí. <em>Solo puedes cazar conejos.</em>`;
        actionBtnLabel = "⚡ Cazar y pasar a Restos orgánicos";
      } else if (state.phase === "turn_remains") {
        title = "🦴 Turno de Restos Orgánicos";
        instruction =
          m.pendingRemains > 0
            ? `Hay <strong>${m.pendingRemains} conejo(s) cazados</strong>.<br>👉 Haz clic en <strong>🦴 Restos</strong> en el círculo central para colocar las fichas grises.`
            : "No hay nuevos restos orgánicos en esta ronda.<br>👉 Pulsa para pasar el turno a <strong>🐞 Insectos</strong>.";
        actionBtnLabel = m.pendingRemains > 0 ? "🦴 Colocar Restos y pasar a Insectos" : "➡️ Pasar turno a Insectos";
      } else if (state.phase === "turn_insects") {
        const leftToRecycle = Math.min(b.insects - m.remainsRecycled, b.remains);
        title = "🐞 Turno de Insectos";
        instruction =
          leftToRecycle > 0
            ? `<strong>Reciclados:</strong> ${m.remainsRecycled}/${b.insects} (quedan ${b.remains} restos).<br>👉 Haz clic en <strong>🦴 Restos</strong> para descomponer 1 resto (+2 nutrientes).`
            : `No hay restos que reciclar (quedan ${b.remains} restos y ${b.insects} insectos).<br>👉 Pasa el turno a <strong>🪱 Nutrientes</strong>.`;
        actionBtnLabel = leftToRecycle > 0 ? "♻️ Reciclar todo y pasar a Nutrientes" : "➡️ Pasar turno a Nutrientes";
      } else if (state.phase === "turn_nutrients") {
        const maxEx = EcoGame.engine.getMaxExchange(state);
        title = "🪱 Turno de Nutrientes";
        instruction = `<strong>Preparados para plantar:</strong> ${m.nutrientsSentToPlants} / ${maxEx} (máx. 1 por insecto vivo).<br>👉 Haz clic en <strong>🌱 Plantas</strong> para enviar 1 nutriente y luego pulsa Pasar turno.`;
        actionBtnLabel = "✅ Pasar turno a Plantas";
      } else if (state.phase === "turn_plants") {
        const plantYield = state.variant === "balanced" ? m.nutrientsSentToPlants * 2 : m.nutrientsSentToPlants;
        title = "🌱 Turno de Plantas";
        instruction = `Nutrientes recibidos: <strong>${m.nutrientsSentToPlants}</strong> (brotarán <strong>+${plantYield} plantas</strong>${
          state.variant === "balanced" && b.plants > 0 && b.insects > 0 ? " +2 por polinización" : ""
        }).<br>👉 Haz clic en <strong>🌱 Plantas</strong> para hacerlas brotar y calcular nacimientos.`;
        actionBtnLabel = "🌱 Hacer brotar y cerrar ronda";
      }

      box.innerHTML = `
        <span class="phase-badge">${activeRoleObj ? activeRoleObj.emoji + " " + activeRoleObj.name : ""} · ${ownerLabel}</span>
        <h3>${title}</h3>
        <div class="rule-preview">${instruction}</div>
        ${
          isBotTurn
            ? `<div class="role-notice">🤖 <strong>${ownerLabel}</strong> está realizando su movimiento...</div>`
            : canAct
            ? `<button id="btn-pass-or-complete" class="btn btn-primary btn-lg full-width">${actionBtnLabel}</button>`
            : `<div class="role-notice">⏳ Esperando a que <strong>${ownerLabel}</strong> mueva sus fichas en el tablero.</div>`
        }
      `;

      const passBtn = $("btn-pass-or-complete");
      if (passBtn) {
        passBtn.addEventListener("click", () => {
          EcoGame.sound.playPop();
          if (state.phase === "turn_nutrients") {
            EcoGame.room.dispatchGameAction("PASS_TURN");
          } else {
            EcoGame.room.dispatchGameAction("PERFORM_MOVE", { targetZone: targetKey, mode: "all" });
          }
        });
      }
      return;
    }

    if (state.phase === "round_end") {
      const isLast = state.round >= state.maxRounds;
      box.innerHTML = `
        <span class="phase-badge">Fin de Ronda ${state.round} · Tabla de Registro</span>
        <h3>📋 ¡Ronda completada!</h3>
        <p class="small">Los datos de todas las especies se han anotado en la tabla y la gráfica.</p>
        <div style="display:flex; flex-direction:column; gap:0.55rem;">
          <button id="btn-next-round" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
            ${isLast ? "🏁 Ver Puesta en Común Final" : `➡️ Pasar a Ronda ${state.round + 1}`}
          </button>
          ${
            !isLast
              ? `<button id="btn-extra-card" class="btn btn-secondary btn-sm full-width" ${canAct ? "" : "disabled"}>
                  🃏 Robar otra Carta del Ecosistema ahora
                </button>`
              : ""
          }
        </div>
      `;
      $("btn-next-round").addEventListener("click", () => {
        EcoGame.sound.playPop();
        EcoGame.room.dispatchGameAction("NEXT_ROUND");
      });
      const extraBtn = $("btn-extra-card");
      if (extraBtn) {
        extraBtn.addEventListener("click", () => {
          EcoGame.sound.playCard();
          EcoGame.room.dispatchGameAction("EXTRA_CARD");
        });
      }
    }
  }

  function renderSummary(state) {
    showScreen("screen-summary");
    const analysis = EcoGame.engine.analyzeEcosystem(state);
    $("summary-title").textContent = state.collapsed
      ? "💀 Ecosistema insostenible: todo ha muerto"
      : analysis.collapsed
      ? "El ecosistema sufrió un desequilibrio"
      : "¡El ecosistema mantuvo su equilibrio dinámico!";
    $("summary-subtitle").textContent = state.collapsed
      ? state.collapseReason
      : "Observad la gráfica de evolución y poned en común por qué ha ocurrido cada cambio en la red trófica.";

    renderChart($("summary-chart"), state.history);

    const b = state.board;
    $("summary-final-stats").innerHTML = `
      <div class="stat-mini">🪱 Nutrientes<strong>${b.nutrients}</strong></div>
      <div class="stat-mini">🌱 Plantas<strong>${b.plants}</strong></div>
      <div class="stat-mini">🐇 Conejos<strong>${b.rabbits}</strong></div>
      <div class="stat-mini">🐆 Linces<strong>${b.lynx}</strong></div>
      <div class="stat-mini">🐞 Insectos<strong>${b.insects}</strong></div>
      <div class="stat-mini">🦴 Restos<strong>${b.remains}</strong></div>
    `;

    const insList = $("summary-insights");
    insList.innerHTML = "";
    analysis.insights.forEach((txt) => {
      const li = document.createElement("li");
      li.textContent = txt;
      insList.appendChild(li);
    });

    const quizBox = $("quiz-container");
    quizBox.innerHTML = "";
    EcoGame.QUIZ_CASES.forEach((q) => {
      const card = document.createElement("div");
      card.className = "quiz-item";
      card.innerHTML = `
        <span class="badge-pill">${escapeHtml(q.badge)}</span>
        <h4>${escapeHtml(q.title)}</h4>
        <p class="small muted">${escapeHtml(q.prompt)}</p>
        <div class="quiz-options">
          ${q.options
            .map(
              (opt, idx) =>
                `<button type="button" class="quiz-opt" data-idx="${idx}">${escapeHtml(opt.text)}</button>`
            )
            .join("")}
        </div>
        <div class="quiz-feedback hidden"></div>
      `;
      const fb = card.querySelector(".quiz-feedback");
      card.querySelectorAll(".quiz-opt").forEach((btn) => {
        btn.addEventListener("click", () => {
          const opt = q.options[Number(btn.dataset.idx)];
          card.querySelectorAll(".quiz-opt").forEach((o) => o.classList.remove("correct", "wrong"));
          btn.classList.add(opt.correct ? "correct" : "wrong");
          fb.classList.remove("hidden");
          fb.textContent = opt.correct
            ? q.feedback
            : "Piénsalo desde el pensamiento sistémico: todo está conectado en la red trófica. ¡Prueba otra respuesta!";
          opt.correct ? EcoGame.sound.playGood() : EcoGame.sound.playWarn();
        });
      });
      quizBox.appendChild(card);
    });

    $("btn-play-again").classList.toggle("hidden", !EcoGame.room.isHostOrLocal());
  }

  EcoGame.ui = {
    showScreen,
    showToast,
    shakeZone,
    renderLobby,
    renderGame,
    renderSummary,
    markChatRead(count) {
      lastSeenChatCount = count || 0;
      $("chat-badge").classList.add("hidden");
    },
    setLobbyConnStatus(text, level = "ok") {
      const el = $("lobby-conn-status");
      el.textContent = (level === "ok" ? "🟢 " : level === "warning" ? "🟡 " : "🔴 ") + text;
      el.className = `conn-banner ${level === "ok" ? "" : level}`;
    },
    setJoinStatus(text, isError = false) {
      const el = $("join-status");
      el.textContent = text;
      el.className = `status-msg ${isError ? "error" : ""}`;
      el.classList.remove("hidden");
    },
    clearJoinStatus() {
      $("join-status").classList.add("hidden");
    },
  };
})(window);
