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
    }, 3200);
  }

  function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
  }

  let exchangeSliderVal = 0;
  let lastSeenChatCount = 0;
  let lastPendingCardKey = null;

  function renderTokens(containerId, count, cssClass, emoji, emojisPool = null) {
    const el = $(containerId);
    el.innerHTML = "";
    const capped = Math.min(count, 32);
    for (let i = 0; i < capped; i++) {
      const chip = document.createElement("span");
      chip.className = `token-chip ${cssClass}`;
      chip.textContent = emojisPool ? emojisPool[i % emojisPool.length] : emoji;
      el.appendChild(chip);
    }
    if (count > 32) {
      const extra = document.createElement("span");
      extra.className = "mini-pill pill-yellow";
      extra.textContent = `+${count - 32}`;
      el.appendChild(extra);
    }
  }

  function renderCenterTokens(insects, remains) {
    const el = $("tokens-center");
    el.innerHTML = "";
    const insEmojis = EcoGame.SPECIES.insects.emojis;
    for (let i = 0; i < Math.min(insects, 10); i++) {
      const chip = document.createElement("span");
      chip.className = "token-chip token-insects";
      chip.textContent = insEmojis[i % insEmojis.length];
      chip.title = "Insecto (ficha amarilla)";
      el.appendChild(chip);
    }
    for (let i = 0; i < Math.min(remains, 12); i++) {
      const chip = document.createElement("span");
      chip.className = "token-chip token-remains";
      chip.textContent = "🦴";
      chip.title = "Resto orgánico (ficha gris)";
      el.appendChild(chip);
    }
    if (remains > 12) {
      const extra = document.createElement("span");
      extra.className = "mini-pill pill-grey";
      extra.textContent = `+${remains - 12} restos`;
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
      const occupants = state.players.filter((p) => p.role === role.id).map((p) => p.name);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `role-btn ${myRole === role.id ? "selected" : ""}`;
      btn.innerHTML = `
        <div class="role-btn-title">
          <span>${role.emoji} ${role.name}</span>
          ${myRole === role.id ? "<span>✅</span>" : ""}
        </div>
        <div class="role-btn-desc">${role.desc}</div>
        ${
          occupants.length > 0
            ? `<div class="role-occupant">A cargo: ${escapeHtml(occupants.join(", "))}</div>`
            : `<div class="role-occupant muted">Sin asignar</div>`
        }
      `;
      btn.addEventListener("click", () => {
        EcoGame.sound.playPop();
        EcoGame.room.dispatch("SELECT_ROLE", { role: myRole === role.id ? null : role.id });
      });
      rolesGrid.appendChild(btn);
    });

    const pList = $("lobby-player-list");
    pList.innerHTML = "";
    $("lobby-player-count").textContent = state.players.length;
    state.players.forEach((p) => {
      const roleObj = EcoGame.ROLES.find((r) => r.id === p.role);
      const li = document.createElement("li");
      li.className = "player-item";
      li.innerHTML = `
        <div class="player-meta">
          <span>${roleObj ? roleObj.emoji : "👤"}</span>
          <span>${escapeHtml(p.name)}</span>
          ${p.isHost ? '<span class="host-tag">Anfitrión</span>' : ""}
        </div>
        <span class="badge-pill badge-outline">${roleObj ? roleObj.name : "Sin zona"}</span>
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
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="Gráfica de evolución de especies">
        ${gridLines}
        ${xLabels}
        ${paths}
      </svg>
    `;
  }

  function renderGame(state) {
    showScreen("screen-game");

    const eco = EcoGame.ECOSYSTEMS[state.ecosystem] || EcoGame.ECOSYSTEMS.donana;
    $("hud-round-num").textContent = `${state.round} / ${state.maxRounds}`;
    $("hud-eco-name").textContent = eco.name;

    const me = EcoGame.room.getMyPlayer();
    const myRoleObj = me && me.role ? EcoGame.ROLES.find((r) => r.id === me.role) : null;
    $("hud-my-role").textContent = myRoleObj
      ? `Tu rol: ${myRoleObj.emoji} ${myRoleObj.name}`
      : EcoGame.room.mode === "local"
      ? "Modo un dispositivo"
      : "Rol libre (sin zona fija)";

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

    // Tablero 5 zonas
    const b = state.board;
    $("count-nutrients").textContent = b.nutrients;
    $("count-plants").textContent = b.plants;
    $("count-rabbits").textContent = b.rabbits;
    $("count-lynx").textContent = b.lynx;
    $("count-insects").textContent = b.insects;
    $("count-remains").textContent = b.remains;

    renderTokens("tokens-nutrients", b.nutrients, "token-nutrients", "🪱");
    renderTokens("tokens-plants", b.plants, "token-plants", "🌱");
    renderTokens("tokens-rabbits", b.rabbits, "token-rabbits", "🐇");
    renderTokens("tokens-lynx", b.lynx, "token-lynx", "🐆");
    renderCenterTokens(b.insects, b.remains);

    // Propietarios de zonas y resaltado activo
    const activeZone = EcoGame.engine.getActivePhaseRole(state.phase);
    document.querySelectorAll(".zone").forEach((z) => {
      const zName = z.getAttribute("data-zone");
      z.classList.toggle("highlight-active", activeZone === zName);
      const owners = state.players.filter((p) => p.role === zName).map((p) => p.name);
      const footerEl = $(`owner-${zName}`);
      if (footerEl) {
        footerEl.textContent = owners.length ? `Encargado/a: ${owners.join(", ")}` : "";
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

    // Chat + badge de mensajes sin leer
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
    const canAct = EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase);
    const neededRole = EcoGame.engine.getActivePhaseRole(state.phase);
    const neededRoleObj = EcoGame.ROLES.find((r) => r.id === neededRole);

    const roleLockNote =
      !canAct && neededRoleObj
        ? `<div class="role-notice">⏳ Turno de: <strong>${neededRoleObj.emoji} ${neededRoleObj.name}</strong> (esperando su acción).</div>`
        : "";

    if (state.phase === "card") {
      box.innerHTML = `
        <span class="phase-badge">Inicio de Ronda ${state.round} · Carta del Ecosistema</span>
        <h3>🃏 ¡Robar carta especial!</h3>
        <p>Como indica el documento en la Ronda 3, un cambio inesperado altera el ecosistema. Robad una carta para ver qué ocurre.</p>
        <button id="btn-draw-card" class="btn btn-accent btn-lg full-width" ${canAct ? "" : "disabled"}>
          🎲 Robar Carta del Ecosistema
        </button>
        ${roleLockNote}
      `;
      $("btn-draw-card").addEventListener("click", () => {
        EcoGame.room.dispatchGameAction("DRAW_CARD");
      });
      return;
    }

    if (state.phase === "predict") {
      const myPred = state.predictions[EcoGame.room.myId]?.choice || null;
      const votes = Object.values(state.predictions);
      const predLabels = {
        up: "📈 Suben los animales",
        stable: "⚖️ Se mantiene",
        down: "📉 Bajan / falta comida",
        collapse: "⚠️ Efecto dominó",
      };
      box.innerHTML = `
        <span class="phase-badge">Antes de mover fichas · Pensamiento Sistémico</span>
        <h3>🔮 ¿Qué creéis que pasará en la Ronda ${state.round}?</h3>
        <p class="small muted">Comentad y votad vuestra hipótesis antes de iniciar la alimentación:</p>
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
            ? `<div class="rule-preview"><strong>Hipótesis del equipo:</strong> ${votes
                .map((v) => `${escapeHtml(v.name)}: ${predLabels[v.choice]}`)
                .join(" · ")}</div>`
            : ""
        }
        <button id="btn-start-feed" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
          ➡️ Empezar Fase 1: Alimentación
        </button>
        ${roleLockNote}
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

    if (state.phase === "feed_rabbits") {
      const need = b.rabbits * 2;
      const canFeed = Math.min(b.rabbits, Math.floor(b.plants / 2));
      const starved = b.rabbits - canFeed;
      box.innerHTML = `
        <span class="phase-badge">Fase 1 · Alimentación (Herbívoros)</span>
        <h3>🐇 Los conejos comen plantas</h3>
        <div class="rule-preview">
          <strong>Regla:</strong> 1 conejo come <strong>2 plantas</strong> (van a la caja). Si no hay suficiente comida, muere.<br>
          <strong>Previsión:</strong> Hay <strong>${b.rabbits} conejos</strong> (necesitan ${need} plantas) y hay <strong>${b.plants} plantas</strong>.
          ${starved > 0 ? `<br>⚠️ Morirán <strong>${starved}</strong> conejo(s).` : ""}
        </div>
        <button id="btn-feed-rabbits" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
          🌱 Alimentar a los Conejos
        </button>
        ${roleLockNote}
      `;
      $("btn-feed-rabbits").addEventListener("click", () => {
        starved > 0 ? EcoGame.sound.playWarn() : EcoGame.sound.playPop();
        EcoGame.room.dispatchGameAction("FEED_RABBITS");
      });
      return;
    }

    if (state.phase === "feed_lynx") {
      const need = b.lynx * 2;
      const canFeed = Math.min(b.lynx, Math.floor(b.rabbits / 2));
      const starved = b.lynx - canFeed;
      box.innerHTML = `
        <span class="phase-badge">Fase 1 · Alimentación (Depredadores)</span>
        <h3>🐆 El lince ibérico caza conejos</h3>
        <div class="rule-preview">
          <strong>Regla:</strong> 1 lince come <strong>2 conejos</strong>. Los conejos cazados no desaparecen: pasan al centro como <strong>fichas grises (restos orgánicos)</strong>.<br>
          <strong>Previsión:</strong> Hay <strong>${b.lynx} lince(s)</strong> (necesitan ${need} conejos) y quedan <strong>${b.rabbits} conejos</strong>.
          ${starved > 0 ? `<br>⚠️ Morirá <strong>${starved}</strong> lince(s) por falta de presas.` : ""}
        </div>
        <button id="btn-feed-lynx" class="btn btn-accent btn-lg full-width" ${canAct ? "" : "disabled"}>
          🦴 Cazar y dejar Restos Orgánicos
        </button>
        ${roleLockNote}
      `;
      $("btn-feed-lynx").addEventListener("click", () => {
        starved > 0 ? EcoGame.sound.playWarn() : EcoGame.sound.playPop();
        EcoGame.room.dispatchGameAction("FEED_LYNX");
      });
      return;
    }

    if (state.phase === "feed_insects") {
      const refPlants = state.roundMeta.plantsAtFeedStart;
      const supported = Math.min(b.insects, Math.floor(refPlants / 3));
      const died = b.insects - supported;
      box.innerHTML = `
        <span class="phase-badge">Fase 1 · Alimentación (Insectos)</span>
        <h3>🐞 Supervivencia de los insectos</h3>
        <div class="rule-preview">
          <strong>Regla:</strong> 1 insecto necesita al menos <strong>3 plantas</strong> para vivir (no las elimina).<br>
          <strong>Previsión:</strong> Al inicio de la fase había <strong>${refPlants} plantas</strong> y hay <strong>${b.insects} insectos</strong>. Sobrevivirán <strong>${supported}</strong>${died > 0 ? ` (mueren ${died})` : ""}.
        </div>
        <button id="btn-feed-insects" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
          🐞 Comprobar Insectos
        </button>
        ${roleLockNote}
      `;
      $("btn-feed-insects").addEventListener("click", () => {
        died > 0 ? EcoGame.sound.playWarn() : EcoGame.sound.playGood();
        EcoGame.room.dispatchGameAction("FEED_INSECTS");
      });
      return;
    }

    if (state.phase === "recycle") {
      const processed = Math.min(b.insects, b.remains);
      box.innerHTML = `
        <span class="phase-badge">Fase 2 · Reciclaje y Descomposición</span>
        <h3>♻️ Los descomponedores reciclan restos</h3>
        <div class="rule-preview">
          <strong>Regla:</strong> 1 insecto come <strong>1 resto orgánico</strong> (ficha gris) y lo transforma en <strong>2 nutrientes</strong> (fichas marrones).<br>
          <strong>Previsión:</strong> Con ${b.insects} insecto(s) y ${b.remains} resto(s), se reciclarán <strong>${processed}</strong> resto(s) → <strong>+${processed * 2} nutrientes</strong> (según reserva).
        </div>
        <button id="btn-recycle" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
          🪱 Descomponer Restos en Nutrientes
        </button>
        ${roleLockNote}
      `;
      $("btn-recycle").addEventListener("click", () => {
        EcoGame.sound.playGood();
        EcoGame.room.dispatchGameAction("RECYCLE");
      });
      return;
    }

    if (state.phase === "growth_exchange") {
      const maxEx = EcoGame.engine.getMaxExchange(state);
      if (exchangeSliderVal > maxEx) exchangeSliderVal = maxEx;
      if (exchangeSliderVal === 0 && maxEx > 0) exchangeSliderVal = maxEx;
      const plantPerEx = state.variant === "balanced" ? 2 : 1;
      box.innerHTML = `
        <span class="phase-badge">Fase 3 · Crecimiento (Intercambio)</span>
        <h3>🌱 Transformar nutrientes en plantas</h3>
        <div class="rule-preview">
          <strong>Regla:</strong> Por cada insecto vivo (${b.insects}) se puede intercambiar <strong>1 nutriente</strong> por <strong>${plantPerEx} planta(s)</strong> de la Reserva.<br>
          <strong>Máximo posible ahora:</strong> ${maxEx} intercambio(s).
        </div>
        <div class="exchange-control">
          <div>
            <strong>Intercambiar:</strong><br>
            <small>${exchangeSliderVal} 🪱 → +${exchangeSliderVal * plantPerEx} 🌱</small>
          </div>
          <div class="stepper-ctrl">
            <button type="button" id="ex-minus" ${canAct ? "" : "disabled"}>−</button>
            <span id="ex-val">${exchangeSliderVal}</span>
            <button type="button" id="ex-plus" ${canAct ? "" : "disabled"}>+</button>
          </div>
        </div>
        <button id="btn-exchange" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
          ✅ Confirmar Intercambio
        </button>
        ${roleLockNote}
      `;
      $("ex-minus").addEventListener("click", () => {
        exchangeSliderVal = Math.max(0, exchangeSliderVal - 1);
        renderPhaseAction(state);
      });
      $("ex-plus").addEventListener("click", () => {
        exchangeSliderVal = Math.min(maxEx, exchangeSliderVal + 1);
        renderPhaseAction(state);
      });
      $("btn-exchange").addEventListener("click", () => {
        EcoGame.sound.playGood();
        EcoGame.room.dispatchGameAction("GROWTH_EXCHANGE", { count: exchangeSliderVal });
        exchangeSliderVal = 0;
      });
      return;
    }

    if (state.phase === "growth_repro") {
      const newR = Math.floor(state.roundMeta.fedRabbits / 2);
      const newL = Math.min(Math.floor(state.roundMeta.fedLynx / 2), Math.floor(state.roundMeta.fedRabbits / 4));
      const newI =
        state.noInsectsRoundsLeft === 0 && b.insects >= 1
          ? Math.min(Math.floor(b.plants / 8), Math.max(0, 5 - b.insects))
          : 0;
      box.innerHTML = `
        <span class="phase-badge">Fase 3 · Crecimiento (Reproducción)</span>
        <h3>🐣 Nacimientos del ecosistema</h3>
        <div class="rule-preview">
          • 🐇 +1 conejo por cada 2 conejos bien alimentados → <strong>+${newR}</strong><br>
          • 🐆 +1 lince por cada 2 linces y 4 conejos bien alimentados → <strong>+${newL}</strong><br>
          • 🐞 +1 insecto por cada 8 plantas y 1 insecto (máx. 5) → <strong>+${newI}</strong>
        </div>
        <button id="btn-repro" class="btn btn-primary btn-lg full-width" ${canAct ? "" : "disabled"}>
          🐣 Aplicar Nacimientos y Registrar Ronda
        </button>
        ${roleLockNote}
      `;
      $("btn-repro").addEventListener("click", () => {
        EcoGame.sound.playGood();
        EcoGame.room.dispatchGameAction("GROWTH_REPRO");
      });
      return;
    }

    if (state.phase === "round_end") {
      const isLast = state.round >= state.maxRounds;
      box.innerHTML = `
        <span class="phase-badge">Fin de Ronda ${state.round} · Tabla de Registro</span>
        <h3>📋 ¡Datos guardados en la tabla!</h3>
        <p class="small">Revisa la pestaña <strong>Registro y Gráfica</strong> para ver cómo cambian las especies ronda a ronda.</p>
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
        ${roleLockNote}
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
    $("summary-title").textContent = analysis.collapsed
      ? "El ecosistema sufrió un desequilibrio"
      : "¡El ecosistema mantuvo su equilibrio dinámico!";
    $("summary-subtitle").textContent =
      "Observad la gráfica de evolución y poned en común por qué ha ocurrido cada cambio en la red trófica.";

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

    // Comprobación del aprendizaje (Quiz Noticia Real)
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
