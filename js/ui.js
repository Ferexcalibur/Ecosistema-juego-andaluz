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

  function spawnFloater(x, y, text) {
    if (!text) return;
    const el = document.createElement("div");
    el.className = "board-floater";
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
    if (screenId !== "screen-game") {
      $("modal-card").classList.add("hidden");
    }
  }

  let lastSeenChatCount = 0;
  let lastPendingCardKey = null;
  let dragInitialized = false;
  let suppressNextBoardClick = false;
  let lastPointerPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  function getZoneKeyAtPoint(x, y) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (el.id === "drag-ghost") continue;
      const sub = el.closest(".center-subzone");
      if (sub && sub.dataset.role) return { key: sub.dataset.role, el: sub };
      const res = el.closest("#reserve-box");
      if (res) return { key: "reserve", el: res };
      const z = el.closest(".zone[data-zone]");
      if (z) {
        const key = z.dataset.zone === "center" ? "remains" : z.dataset.zone;
        return { key, el: z };
      }
    }
    return null;
  }

  function initPhysicalDrag() {
    if (dragInitialized) return;
    dragInitialized = true;

    const ghost = $("drag-ghost");
    let dragState = null;
    let blockedDoneDrag = false;

    document.addEventListener("pointerdown", (e) => {
      const tokenEl = e.target.closest("[data-drag-source]");
      if (!tokenEl) return;
      const state = EcoGame.room.state;
      if (!state || state.status !== "playing") return;

      if (!EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase)) {
        const owner = EcoGame.engine.getTurnOwner(state);
        if (owner) {
          showToast(
            owner.isBot
              ? `🤖 Turno automático de ${owner.name}...`
              : `⏳ Turno de ${owner.name}. Solo él/ella mueve sus fichas.`
          );
        }
        return;
      }

      if (tokenEl.classList.contains("token-done")) {
        blockedDoneDrag = true;
        suppressNextBoardClick = true;
        EcoGame.sound.playWarn();
        showToast("🚫 Esta ficha ya completó su ración de esta ronda. ¡Debes mover otra ficha!");
        return;
      }

      e.preventDefault();
      lastPointerPos = { x: e.clientX, y: e.clientY };
      dragState = {
        sourceKey: tokenEl.dataset.dragSource,
        tokenIndex: tokenEl.dataset.tokenIndex !== undefined ? Number(tokenEl.dataset.tokenIndex) : null,
        emoji: tokenEl.dataset.dragEmoji || tokenEl.textContent.trim().slice(0, 2),
        chipClass: tokenEl.dataset.chipClass || "token-plants",
        originEl: tokenEl,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    });

    document.addEventListener("pointermove", (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!dragState.moved && Math.hypot(dx, dy) >= 6) {
        dragState.moved = true;
        dragState.originEl.classList.add("token-being-dragged");
        ghost.className = `drag-ghost ${dragState.chipClass}`;
        ghost.textContent = dragState.emoji;
        ghost.classList.remove("hidden");
      }
      if (dragState.moved) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        document.querySelectorAll(".drop-hover").forEach((el) => el.classList.remove("drop-hover"));
        const hit = getZoneKeyAtPoint(e.clientX, e.clientY);
        if (hit && hit.el) hit.el.classList.add("drop-hover");
      }
    });

    const endDrag = (e) => {
      if (blockedDoneDrag) {
        blockedDoneDrag = false;
        suppressNextBoardClick = true;
        setTimeout(() => { suppressNextBoardClick = false; }, 80);
        return;
      }
      if (!dragState) return;
      const current = dragState;
      dragState = null;

      ghost.classList.add("hidden");
      current.originEl.classList.remove("token-being-dragged");
      document.querySelectorAll(".drop-hover").forEach((el) => el.classList.remove("drop-hover"));
      lastPointerPos = { x: e.clientX, y: e.clientY };

      const state = EcoGame.room.state;
      if (!state || state.status !== "playing") return;

      if (current.moved) {
        const hit = getZoneKeyAtPoint(e.clientX, e.clientY);
        if (!hit) return;
        if (hit.key === current.sourceKey && state.phase !== "turn_plants") {
          showToast("🖐️ Arrastra la ficha hasta su zona o especie objetivo.");
          return;
        }
        EcoGame.sound.playPop();
        EcoGame.room.dispatchGameAction("PERFORM_MOVE", {
          sourceZone: current.sourceKey,
          targetZone: hit.key,
          tokenIndex: current.tokenIndex,
          mode: "one",
        });
      }
    };

    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);

    // También permitir clic directo en ficha objetivo o zona objetivo iluminada
    $("ecosystem-board").addEventListener("click", (e) => {
      if (suppressNextBoardClick) {
        suppressNextBoardClick = false;
        return;
      }
      const state = EcoGame.room.state;
      if (!state || state.status !== "playing") return;
      const activeRole = EcoGame.engine.getActivePhaseRole(state.phase);
      if (!activeRole) return;
      if (!EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase)) return;

      lastPointerPos = { x: e.clientX, y: e.clientY };
      const hit = getZoneKeyAtPoint(e.clientX, e.clientY);
      if (!hit) return;
      // Si hace clic en su propia zona (y no es turn_plants), invitar a arrastrar hacia la presa/objetivo
      if (hit.key === activeRole && state.phase !== "turn_plants" && state.phase !== "turn_remains") {
        showToast("🖐️ ¡Coge tu ficha y arrástrala sobre el objetivo iluminado (o haz clic en el objetivo)!");
        return;
      }
      EcoGame.sound.playPop();
      EcoGame.room.dispatchGameAction("PERFORM_MOVE", {
        sourceZone: activeRole,
        targetZone: hit.key,
        mode: "one",
      });
    });

    $("reserve-box").addEventListener("click", (e) => {
      if (e.target.closest("[data-drag-source]")) return;
      const state = EcoGame.room.state;
      if (!state || state.status !== "playing") return;
      const activeRole = EcoGame.engine.getActivePhaseRole(state.phase);
      if (!activeRole || !EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase)) return;
      lastPointerPos = { x: e.clientX, y: e.clientY };
      EcoGame.sound.playPop();
      EcoGame.room.dispatchGameAction("PERFORM_MOVE", {
        sourceZone: activeRole,
        targetZone: "reserve",
        mode: "one",
      });
    });
  }

  function shakeZone(zoneKey) {
    if (!zoneKey) return;
    const el =
      zoneKey === "insects" || zoneKey === "remains"
        ? $(`subzone-${zoneKey}`)
        : zoneKey === "reserve"
        ? $("reserve-box")
        : document.querySelector(`.zone[data-zone="${zoneKey}"]`);
    if (!el) return;
    el.classList.remove("zone-shake");
    void el.offsetWidth;
    el.classList.add("zone-shake");
  }

  function getActiveGuidance(state) {
    const b = state.board;
    const m = state.roundMeta;
    const p = state.phase;
    if (p === "turn_rabbits") {
      const rp = Array.isArray(m.rabbitProgress) ? m.rabbitProgress : [];
      const anyNeedsOne = rp.some((v) => v === 1);
      const canEat = b.plants >= 2 || (anyNeedsOne && b.plants >= 1);
      return canEat
        ? { source: "rabbits", target: "plants", hint: "Arrastra cada 🐇 Conejo (que no tenga ✅) sobre una 🌱 Planta dos veces (2 plantas por conejo)" }
        : { source: "rabbits", target: "reserve", hint: "No quedan plantas: arrastra los 🐇 Conejos sin comida a 📦 Reserva" };
    }
    if (p === "turn_lynx") {
      const lp = Array.isArray(m.lynxProgress) ? m.lynxProgress : [];
      const anyNeedsOne = lp.some((v) => v === 1);
      const canHunt = b.rabbits >= 2 || (anyNeedsOne && b.rabbits >= 1);
      return canHunt
        ? { source: "lynx", target: "rabbits", hint: "Arrastra cada 🐆 Lince sobre un 🐇 Conejo dos veces (2 conejos por lince)" }
        : { source: "lynx", target: "reserve", hint: "No quedan suficientes conejos: arrastra el 🐆 Lince a 📦 Reserva" };
    }
    if (p === "turn_remains") {
      return { source: "tray_remains", target: "remains", hint: "Arrastra las fichas grises 🦴 hasta la zona Restos del centro" };
    }
    if (p === "turn_insects") {
      return { source: "insects", target: "remains", hint: "Arrastra un 🐞 Insecto sobre un 🦴 Resto orgánico del centro para reciclarlo" };
    }
    if (p === "turn_nutrients") {
      if (m.pendingNutrients > 0) {
        return { source: "tray_nutrients", target: "nutrients", hint: "Recoge los 🪱 Nutrientes nuevos y arrástralos a la Zona Suelo" };
      }
      return { source: "nutrients", target: "plants", hint: "Arrastra 🪱 Nutrientes desde Suelo hacia 🌱 Plantas (máx. 1 por insecto vivo)" };
    }
    if (p === "turn_plants") {
      return { source: "tray_plants", target: "plants", hint: "Arrastra las 🌱 Plantas nuevas desde la bandeja a la Zona Plantas" };
    }
    return { source: null, target: null, hint: "" };
  }

  function renderTokens(containerId, count, cssClass, emoji, roleKey, isDraggable, isTargetGlow, emojisPool = null, pipBuilder = null) {
    const el = $(containerId);
    el.innerHTML = "";
    const capped = Math.min(count, 28);
    for (let i = 0; i < capped; i++) {
      const chipEmoji = emojisPool ? emojisPool[i % emojisPool.length] : emoji;
      const pipInfo = pipBuilder ? pipBuilder(i) : null;
      const isDone = pipInfo && pipInfo.done;
      const chip = document.createElement("span");
      chip.className = `token-chip ${cssClass} ${isDraggable && !isDone ? "token-draggable" : ""} ${
        isTargetGlow ? "token-target-glow" : ""
      } ${isDone ? "token-done" : ""}`;
      chip.textContent = chipEmoji;
      if (pipInfo && pipInfo.text) {
        const pip = document.createElement("span");
        pip.className = `token-pip ${pipInfo.cls || ""}`;
        pip.textContent = pipInfo.text;
        chip.appendChild(pip);
      }
      if (isDraggable) {
        chip.dataset.dragSource = roleKey;
        chip.dataset.tokenIndex = String(i);
        chip.dataset.dragEmoji = chipEmoji;
        chip.dataset.chipClass = cssClass;
        chip.title = isDone
          ? "Esta ficha ya completó su acción en esta ronda"
          : "Mantén pulsado y arrastra esta ficha";
      }
      el.appendChild(chip);
    }
    if (count > 28) {
      const extra = document.createElement("span");
      extra.className = "mini-pill pill-yellow";
      extra.textContent = `+${count - 28}`;
      el.appendChild(extra);
    }
  }

  function renderTray(state, canAct, guidance) {
    const tray = $("table-tray");
    const box = $("tray-tokens");
    const m = state.roundMeta;
    box.innerHTML = "";

    let items = 0;
    let sourceKey = "";
    let chipClass = "";
    let emoji = "";
    let title = "";
    let hint = "";

    if (state.phase === "turn_remains" && m.pendingRemains > 0) {
      items = m.pendingRemains;
      sourceKey = "tray_remains";
      chipClass = "token-remains";
      emoji = "🦴";
      title = `🖐️ Presas cazadas listas para el centro (${items})`;
      hint = "Arrastra cada ficha gris 🦴 a la zona Restos del círculo central";
    } else if (state.phase === "turn_nutrients" && m.pendingNutrients > 0) {
      items = m.pendingNutrients;
      sourceKey = "tray_nutrients";
      chipClass = "token-nutrients";
      emoji = "🪱";
      title = `🖐️ Nutrientes recién reciclados (${items})`;
      hint = "Arrastra cada ficha marrón 🪱 a la Zona Suelo";
    } else if (state.phase === "turn_plants" && m.plantsToSprout > 0) {
      items = m.plantsToSprout;
      sourceKey = "tray_plants";
      chipClass = "token-plants";
      emoji = "🌱";
      title = `🖐️ Nuevas plantas listas para brotar (${items})`;
      hint = "Arrastra cada ficha verde 🌱 a la Zona Plantas";
    }

    if (items === 0) {
      tray.classList.add("hidden");
      return;
    }

    tray.classList.remove("hidden");
    $("tray-title").textContent = title;
    $("tray-hint").textContent = canAct ? hint : "Esperando al encargado de esta ficha...";

    for (let i = 0; i < Math.min(items, 16); i++) {
      const chip = document.createElement("span");
      chip.className = `token-chip ${chipClass} ${canAct ? "token-draggable" : ""}`;
      chip.textContent = emoji;
      if (canAct) {
        chip.dataset.dragSource = sourceKey;
        chip.dataset.dragEmoji = emoji;
        chip.dataset.chipClass = chipClass;
      }
      box.appendChild(chip);
    }
    if (items > 16) {
      const more = document.createElement("span");
      more.className = "mini-pill pill-yellow";
      more.textContent = `+${items - 16}`;
      box.appendChild(more);
    }
  }

  function renderLobby(state) {
    $("modal-card").classList.add("hidden");
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
    initPhysicalDrag();
    showScreen("screen-game");

    const eco = EcoGame.ECOSYSTEMS[state.ecosystem] || EcoGame.ECOSYSTEMS.donana;
    $("hud-round-num").textContent = `${state.round} / ${state.maxRounds}`;
    $("hud-eco-name").textContent = eco.name;

    const me = EcoGame.room.getMyPlayer();
    const myRoleObj = me && me.role ? EcoGame.ROLES.find((r) => r.id === me.role) : null;
    $("hud-my-role").textContent = state.controlAll
      ? "🎓 Modo Tablero Completo (todas las fichas)"
      : myRoleObj
      ? `Tu ficha: ${myRoleObj.emoji} ${myRoleObj.name}`
      : "Observador";

    if (state.roomCode) {
      $("topbar-room-pill").classList.remove("hidden");
      $("topbar-room-code").textContent = state.roomCode;
    } else {
      $("topbar-room-pill").classList.add("hidden");
    }

    // Stepper
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

    // Tablero
    const b = state.board;
    $("count-nutrients").textContent = b.nutrients;
    $("count-plants").textContent = b.plants;
    $("count-rabbits").textContent = b.rabbits;
    $("count-lynx").textContent = b.lynx;
    $("count-insects").textContent = b.insects;
    $("count-remains").textContent = b.remains;

    const activeRole = EcoGame.engine.getActivePhaseRole(state.phase);
    const canAct = EcoGame.room.canPlayerAct(EcoGame.room.myId, state.phase);
    const guidance = getActiveGuidance(state);

    // Qué fichas puede arrastrar el usuario en esta fase
    const dragSrc = guidance.source;
    const targetKey = guidance.target;

    const m = state.roundMeta;
    const nutPip =
      state.phase === "turn_nutrients" && m.pendingNutrients === 0
        ? (i) =>
            i < m.nutrientsSentToPlants
              ? { text: "✓", cls: "pip-done", done: true }
              : null
        : null;
    const rabPip =
      state.phase === "turn_rabbits" && Array.isArray(m.rabbitProgress)
        ? (i) => {
            const v = m.rabbitProgress[i] || 0;
            if (v >= 2) return { text: "✓", cls: "pip-done", done: true };
            if (v === 1) return { text: "1/2", cls: "pip-mid", done: false };
            return { text: "0/2", cls: "", done: false };
          }
        : null;
    const lynxPip =
      state.phase === "turn_lynx" && Array.isArray(m.lynxProgress)
        ? (i) => {
            const v = m.lynxProgress[i] || 0;
            if (v >= 2) return { text: "✓", cls: "pip-done", done: true };
            if (v === 1) return { text: "1/2", cls: "pip-mid", done: false };
            return { text: "0/2", cls: "", done: false };
          }
        : null;
    const insPip =
      state.phase === "turn_insects" && Array.isArray(m.insectRecycled)
        ? (i) =>
            m.insectRecycled[i]
              ? { text: "✓", cls: "pip-done", done: true }
              : { text: "0/1", cls: "", done: false }
        : null;

    renderTokens(
      "tokens-nutrients",
      b.nutrients,
      "token-nutrients",
      "🪱",
      "nutrients",
      canAct && dragSrc === "nutrients",
      canAct && targetKey === "nutrients",
      null,
      nutPip
    );
    renderTokens(
      "tokens-plants",
      b.plants,
      "token-plants",
      "🌱",
      "plants",
      canAct && (dragSrc === "plants" || (state.phase === "turn_rabbits" && b.plants > 0)),
      canAct && targetKey === "plants"
    );
    renderTokens(
      "tokens-rabbits",
      b.rabbits,
      "token-rabbits",
      "🐇",
      "rabbits",
      canAct && dragSrc === "rabbits",
      canAct && targetKey === "rabbits",
      null,
      rabPip
    );
    renderTokens(
      "tokens-lynx",
      b.lynx,
      "token-lynx",
      "🐆",
      "lynx",
      canAct && dragSrc === "lynx",
      canAct && targetKey === "lynx",
      null,
      lynxPip
    );
    renderTokens(
      "tokens-insects",
      b.insects,
      "token-insects",
      "🐞",
      "insects",
      canAct && dragSrc === "insects",
      canAct && targetKey === "insects",
      EcoGame.SPECIES.insects.emojis,
      insPip
    );
    renderTokens(
      "tokens-remains",
      b.remains,
      "token-remains",
      "🦴",
      "remains",
      canAct && dragSrc === "remains",
      canAct && targetKey === "remains"
    );

    // Resaltado de zonas
    const allZones = ["nutrients", "plants", "rabbits", "lynx", "insects", "remains"];
    allZones.forEach((roleId) => {
      const el =
        roleId === "insects" || roleId === "remains"
          ? $(`subzone-${roleId}`)
          : document.querySelector(`.zone[data-zone="${roleId}"]`);
      if (!el) return;
      el.classList.toggle("zone-owner-turn", activeRole === roleId);
      el.classList.toggle("zone-valid-target", canAct && targetKey === roleId);

      const owner = state.players.find((p) => p.role === roleId);
      const footerEl = $(`owner-${roleId}`);
      if (footerEl) {
        footerEl.textContent = state.controlAll
          ? "🖐️ Control manual"
          : owner
          ? `${owner.isBot ? "🤖 " : "👤 "}${owner.name}`
          : "Sin asignar";
      }
    });

    $("reserve-box").classList.toggle("zone-valid-target", canAct && targetKey === "reserve");

    // Bandeja de fichas pendientes
    renderTray(state, canAct, guidance);

    // Reserva
    const res = state.reserve;
    $("reserve-mode-label").textContent =
      state.variant === "balanced" ? "Variante equilibrio sostenible" : "Arrastra fichas desde o hacia la caja";
    $("reserve-items").innerHTML = `
      <span class="reserve-pill">🪱 Nutrientes: <strong>${res.nutrients}</strong></span>
      <span class="reserve-pill">🌱 Plantas: <strong>${res.plants}</strong></span>
      <span class="reserve-pill">🐇 Conejos: <strong>${res.rabbits}</strong></span>
      <span class="reserve-pill">🐆 Linces: <strong>${res.lynx}</strong></span>
      <span class="reserve-pill">🐞 Insectos: <strong>${res.insects}</strong></span>
      <span class="reserve-pill">🦴 Restos: <strong>${res.remains}</strong></span>
    `;

    // Panel de Acción Actual
    renderPhaseAction(state, guidance);

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

  function renderPhaseAction(state, guidance) {
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
          🖐️ Empezar a mover fichas (1º Conejos)
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
      const isBotTurn = turnOwner && turnOwner.isBot && !state.controlAll;
      const ownerLabel = state.controlAll
        ? "👤 Tú (Tablero físico)"
        : turnOwner
        ? `${turnOwner.isBot ? "🤖 " : "👤 "}${escapeHtml(turnOwner.name)}`
        : "Encargado";

      let title = "";
      let progressHtml = "";
      let passBtnText = "";
      let passAction = "PASS_TURN";

      if (state.phase === "turn_rabbits") {
        const rp = Array.isArray(m.rabbitProgress) ? m.rabbitProgress : [];
        const fullCount = rp.filter((v) => v >= 2).length;
        const anyPartial = rp.some((v) => v === 1);
        title = "🐇 Turno de Conejos (2 plantas por cada conejo)";
        progressHtml = `<div class="hunger-bar">🐇 Llenos: ${fullCount}/${b.rabbits} · Cada conejo con 0/2 o 1/2 debe comer 2 🌱</div>`;
        if ((b.plants === 0 || (b.plants === 1 && !anyPartial)) && fullCount < b.rabbits) {
          passBtnText = "💀 Retirar conejos sin comida a la Caja";
        }
      } else if (state.phase === "turn_lynx") {
        const lp = Array.isArray(m.lynxProgress) ? m.lynxProgress : [];
        const fullCount = lp.filter((v) => v >= 2).length;
        const anyPartial = lp.some((v) => v === 1);
        title = "🐆 Turno de Lince Ibérico (2 conejos por cada lince)";
        progressHtml = `<div class="hunger-bar">🐆 Llenos: ${fullCount}/${b.lynx} · Cada lince caza sus 2 🐇</div>`;
        if ((b.rabbits === 0 || (b.rabbits === 1 && !anyPartial)) && fullCount < b.lynx) {
          passBtnText = "💀 Retirar lince sin presas a la Caja";
        }
      } else if (state.phase === "turn_remains") {
        title = "🦴 Turno de Restos Orgánicos";
        progressHtml = `<div class="hunger-bar">🦴 Fichas grises por colocar en el centro: ${m.pendingRemains}</div>`;
        if (m.pendingRemains === 0) {
          passBtnText = "➡️ No hay restos nuevos · Pasar a Insectos";
        }
      } else if (state.phase === "turn_insects") {
        const ir = Array.isArray(m.insectRecycled) ? m.insectRecycled : [];
        const doneCount = ir.filter(Boolean).length;
        const left = Math.min(b.insects - doneCount, b.remains);
        title = "🐞 Turno de Insectos (1 resto por cada insecto)";
        progressHtml = `<div class="hunger-bar">♻️ Reciclados: ${doneCount}/${b.insects} · Restos disponibles: ${b.remains}</div>`;
        if (left <= 0) {
          passBtnText = "➡️ Pasar turno a Nutrientes";
        }
      } else if (state.phase === "turn_nutrients") {
        const maxEx = EcoGame.engine.getMaxExchange(state);
        title = "🪱 Turno de Nutrientes";
        progressHtml =
          m.pendingNutrients > 0
            ? `<div class="hunger-bar">🪱 Nuevos nutrientes por recoger: ${m.pendingNutrients}</div>`
            : `<div class="hunger-bar">🌱 Enviados a Plantas: ${m.nutrientsSentToPlants} / ${maxEx} (máx. 1 por insecto)</div>`;
        if (m.pendingNutrients === 0) {
          passBtnText = "✅ Pasar turno a Plantas";
        }
      } else if (state.phase === "turn_plants") {
        title = "🌱 Turno de Plantas";
        progressHtml = `<div class="hunger-bar">🌱 Nuevas plantas por brotar: ${m.plantsToSprout}</div>`;
        if (m.plantsToSprout === 0) {
          passBtnText = "🐣 Comprobar nacimientos y cerrar ronda";
        }
      }

      box.innerHTML = `
        <span class="phase-badge">${activeRoleObj ? activeRoleObj.emoji + " " + activeRoleObj.name : ""} · ${ownerLabel}</span>
        <h3>${title}</h3>
        ${progressHtml}
        <div class="rule-preview">🖐️ <strong>Mueve las fichas en el tablero:</strong> ${guidance.hint}</div>
        ${
          isBotTurn
            ? `<div class="role-notice">🤖 <strong>${ownerLabel}</strong> está moviendo sus fichas...</div>`
            : canAct
            ? `
              ${passBtnText ? `<button id="btn-pass-or-complete" class="btn btn-primary btn-lg full-width" style="margin-bottom:0.45rem;">${passBtnText}</button>` : ""}
              ${!passBtnText ? `<button id="btn-quick-turn" class="btn btn-ghost btn-sm full-width">⚡ Completar turno rápido</button>` : ""}
            `
            : `<div class="role-notice">⏳ Esperando a que <strong>${ownerLabel}</strong> mueva sus fichas en el tablero.</div>`
        }
      `;

      const passBtn = $("btn-pass-or-complete");
      if (passBtn) {
        passBtn.addEventListener("click", () => {
          EcoGame.sound.playPop();
          EcoGame.room.dispatchGameAction(passAction);
        });
      }
      const quickBtn = $("btn-quick-turn");
      if (quickBtn) {
        quickBtn.addEventListener("click", () => {
          EcoGame.sound.playPop();
          EcoGame.room.dispatchGameAction("PASS_TURN");
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
    $("modal-card").classList.add("hidden");
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
    spawnFloaterAtLastPointer(text) {
      spawnFloater(lastPointerPos.x, lastPointerPos.y, text);
    },
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
