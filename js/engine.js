(function (global) {
  const EcoGame = (global.EcoGame = global.EcoGame || {});

  const LIVING_KEYS = ["plants", "rabbits", "lynx", "insects"];
  const ROLE_ORDER = ["rabbits", "lynx", "remains", "insects", "nutrients", "plants"];

  function createInitialState(config) {
    const ecosystem = config.ecosystem || "donana";
    const variant = config.variant || "classic";
    const maxRounds = config.maxRounds || 5;
    const controlAll = Boolean(config.controlAll);

    const initialBoard = {
      nutrients: 4,
      plants: 10,
      rabbits: 5,
      lynx: 1,
      insects: 3,
      remains: 0,
    };

    const initialReserve =
      variant === "balanced"
        ? { nutrients: 20, plants: 25, rabbits: 12, lynx: 4, insects: 5, remains: 20 }
        : { nutrients: 6, plants: 5, rabbits: 2, lynx: 1, insects: 2, remains: 12 };

    return {
      status: "lobby",
      roomCode: config.roomCode || null,
      ecosystem,
      variant,
      controlAll,
      maxRounds,
      round: 1,
      phase: "predict",
      collapsed: false,
      collapseReason: null,
      board: { ...initialBoard },
      reserve: { ...initialReserve },
      roundMeta: {
        plantsAtFeedStart: initialBoard.plants,
        rabbitProgress: [],
        fedRabbits: 0,
        lynxProgress: [],
        fedLynx: 0,
        pendingRemains: 0,
        insectRecycled: [],
        pendingNutrients: 0,
        nutrientsSentToPlants: 0,
        plantsToSprout: 0,
      },
      activeCard: null,
      pendingCard: null,
      noInsectsRoundsLeft: 0,
      predictions: {},
      history: [
        {
          round: 0,
          label: "Inicio",
          ...initialBoard,
          card: null,
        },
      ],
      logs: [
        {
          type: "good",
          text: "Tablero inicial preparado: 4 nutrientes, 10 plantas, 5 conejos, 1 lince y 3 insectos.",
        },
      ],
      players: config.players || [],
      chat: [],
    };
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function addLog(state, text, type = "info") {
    state.logs.unshift({ type, text, round: state.round });
    if (state.logs.length > 80) state.logs.length = 80;
  }

  function takeFromReserve(state, key, amount) {
    const avail = state.reserve[key] || 0;
    const actual = Math.max(0, Math.min(amount, avail));
    state.reserve[key] -= actual;
    state.board[key] += actual;
    return actual;
  }

  function returnToReserve(state, key, amount) {
    const actual = Math.max(0, Math.min(amount, state.board[key]));
    state.board[key] -= actual;
    state.reserve[key] = (state.reserve[key] || 0) + actual;
    return actual;
  }

  function fillMissingRolesWithBots(state) {
    if (state.controlAll) return;
    state.players = state.players.filter((p) => !p.isBot);
    ROLE_ORDER.forEach((roleId) => {
      const taken = state.players.some((p) => p.role === roleId);
      if (!taken) {
        const roleObj = EcoGame.ROLES.find((r) => r.id === roleId);
        state.players.push({
          id: `bot-${roleId}`,
          name: `Bot ${roleObj ? roleObj.name.split(" ")[0] : roleId}`,
          role: roleId,
          isHost: false,
          isBot: true,
        });
      }
    });
  }

  function resetRoundMeta(state) {
    state.roundMeta = {
      plantsAtFeedStart: state.board.plants,
      rabbitProgress: Array(state.board.rabbits).fill(0),
      fedRabbits: 0,
      lynxProgress: Array(state.board.lynx).fill(0),
      fedLynx: 0,
      pendingRemains: 0,
      insectRecycled: Array(state.board.insects).fill(false),
      pendingNutrients: 0,
      nutrientsSentToPlants: 0,
      plantsToSprout: 0,
    };
  }

  function startGame(state) {
    const next = cloneState(state);
    fillMissingRolesWithBots(next);
    next.status = "playing";
    next.round = 1;
    next.phase = "predict";
    next.collapsed = false;
    next.collapseReason = null;
    next.pendingCard = null;
    next.predictions = {};
    resetRoundMeta(next);
    const botCount = next.players.filter((p) => p.isBot).length;
    addLog(
      next,
      botCount > 0
        ? `¡Comienza la partida! Roles vacantes cubiertos con ${botCount} Bot(s).`
        : "¡Comienza la partida con equipo humano completo!",
      "good"
    );
    return next;
  }

  function getActivePhaseRole(phase) {
    switch (phase) {
      case "turn_rabbits":
        return "rabbits";
      case "turn_lynx":
        return "lynx";
      case "turn_remains":
        return "remains";
      case "turn_insects":
        return "insects";
      case "turn_nutrients":
        return "nutrients";
      case "turn_plants":
        return "plants";
      default:
        return null;
    }
  }

  function getTurnOwner(state) {
    const role = getActivePhaseRole(state.phase);
    if (!role) return null;
    return state.players.find((p) => p.role === role) || null;
  }

  function checkSustainability(state) {
    const missing = LIVING_KEYS.filter((k) => state.board[k] <= 0);
    if (missing.length >= 2) {
      const missingNames = missing.map((k) => EcoGame.SPECIES[k].label).join(" y ");
      LIVING_KEYS.forEach((k) => {
        if (state.board[k] > 0) {
          returnToReserve(state, k, state.board[k]);
        }
      });
      state.collapsed = true;
      state.collapseReason = `Faltan ${missing.length} especies (${missingNames}). El sistema es insostenible y todas las especies mueren por efecto dominó.`;
      addLog(state, `💀 COLAPSO TOTAL: ${state.collapseReason}`, "warn");
      const alreadySaved = state.history.some((h) => h.round === state.round);
      if (!alreadySaved) {
        state.history.push({
          round: state.round,
          label: `Ronda ${state.round} (Colapso)`,
          ...state.board,
          card: state.activeCard && state.activeCard.drawnRound === state.round ? state.activeCard.title : null,
        });
      }
      state.pendingCard = null;
      state.phase = "round_end";
      state.status = "finished";
      return true;
    }
    return false;
  }

  function enterTurnLynx(state) {
    state.roundMeta.lynxProgress = Array(state.board.lynx).fill(0);
    state.roundMeta.fedRabbits = state.board.rabbits;
    state.phase = "turn_lynx";
  }

  function enterTurnInsects(state) {
    state.phase = "turn_insects";
    const totalInsects = state.board.insects;
    const plantsRef = state.roundMeta.plantsAtFeedStart;
    if (totalInsects === 0) {
      addLog(state, "🐞 No hay insectos vivos en el centro del tablero.", "warn");
    } else {
      const supported = Math.min(totalInsects, Math.floor(plantsRef / 3));
      const died = totalInsects - supported;
      if (died > 0) {
        returnToReserve(state, "insects", died);
        addLog(
          state,
          `🐞 Había ${plantsRef} plantas al inicio (3 por insecto): sobreviven ${supported} insectos y mueren ${died}.`,
          "warn"
        );
      } else {
        addLog(
          state,
          `🐞 Los ${supported} insectos tienen suficientes plantas (≥ ${supported * 3} al inicio) y sobreviven.`,
          "good"
        );
      }
    }
    state.roundMeta.insectRecycled = Array(state.board.insects).fill(false);
    checkSustainability(state);
  }

  function enterTurnPlants(state) {
    const m = state.roundMeta;
    const sent = Math.min(m.nutrientsSentToPlants, state.board.nutrients, state.reserve.plants);
    if (sent > 0) {
      returnToReserve(state, "nutrients", sent);
    }
    const yieldPer = state.variant === "balanced" ? 2 : 1;
    let toSprout = Math.min(state.reserve.plants, sent * yieldPer);
    if (state.variant === "balanced" && state.board.plants > 0 && state.board.insects > 0) {
      toSprout = Math.min(state.reserve.plants, toSprout + 2);
    }
    m.plantsToSprout = toSprout;
    state.phase = "turn_plants";
    if (sent > 0) {
      addLog(state, `🪱 Nutrientes envía ${sent} ficha(s) marrón(es) para hacer brotar ${toSprout} planta(s).`, "good");
    } else {
      addLog(state, "🪱 Nutrientes pasa el turno a Plantas.", "info");
    }
  }

  function finalizePlantsAndBirths(state) {
    const m = state.roundMeta;
    const newRabbits = takeFromReserve(state, "rabbits", Math.floor(m.fedRabbits / 2));
    const newLynx = takeFromReserve(
      state,
      "lynx",
      Math.min(Math.floor(m.fedLynx / 2), Math.floor(m.fedRabbits / 4))
    );
    let newInsects = 0;
    if (state.noInsectsRoundsLeft === 0 && state.board.insects >= 1) {
      const room = Math.max(0, 5 - state.board.insects);
      newInsects = takeFromReserve(state, "insects", Math.min(Math.floor(state.board.plants / 8), room));
    }

    const births = [];
    if (newRabbits > 0) births.push(`+${newRabbits} conejo(s)`);
    if (newLynx > 0) births.push(`+${newLynx} lince(s)`);
    if (newInsects > 0) births.push(`+${newInsects} insecto(s)`);
    if (births.length > 0) {
      addLog(state, `🐣 Nacimientos: ${births.join(", ")}.`, "good");
    } else {
      addLog(state, "🐣 Sin nuevos nacimientos en esta ronda.", "info");
    }

    if (!checkSustainability(state)) {
      state.history.push({
        round: state.round,
        label: `Ronda ${state.round}`,
        ...state.board,
        card: state.activeCard && state.activeCard.drawnRound === state.round ? state.activeCard.title : null,
      });
      state.phase = "round_end";
    }
  }

  function submitPrediction(state, playerId, playerName, choice) {
    const next = cloneState(state);
    next.predictions[playerId] = { name: playerName, choice };
    return next;
  }

  function finishPredict(state) {
    const next = cloneState(state);
    resetRoundMeta(next);
    next.phase = "turn_rabbits";
    addLog(next, `➡️ Ronda ${next.round}: Turno de 🐇 Conejos.`, "info");
    return next;
  }

  function drawEcosystemCard(state, forcedCardId = null) {
    const next = cloneState(state);
    const cards = EcoGame.CARDS;
    const chosen =
      (forcedCardId && cards.find((c) => c.id === forcedCardId)) ||
      cards[Math.floor(Math.random() * cards.length)];
    next.pendingCard = chosen;
    return next;
  }

  function applyPendingCard(state) {
    const next = cloneState(state);
    const card = next.pendingCard;
    next.pendingCard = null;
    if (!card) return next;

    next.activeCard = { ...card, drawnRound: next.round };

    if (card.id === "drought") {
      const lost = Math.floor(next.board.plants / 2);
      returnToReserve(next, "plants", lost);
      addLog(next, `🃏 Sequía extrema: se secan ${lost} plantas (la mitad).`, "card");
    } else if (card.id === "poaching") {
      const lost = next.board.lynx;
      returnToReserve(next, "lynx", lost);
      addLog(next, `🃏 Caza furtiva: desaparecen los ${lost} linces del bosque.`, "card");
    } else if (card.id === "disease") {
      const lost = Math.floor(next.board.rabbits / 2);
      returnToReserve(next, "rabbits", lost);
      addLog(next, `🃏 Enfermedad: mueren ${lost} conejos (la mitad).`, "card");
    } else if (card.id === "insecticide") {
      const lost = next.board.insects;
      returnToReserve(next, "insects", lost);
      next.noInsectsRoundsLeft = 2;
      addLog(
        next,
        `🃏 Uso masivo de insecticidas: mueren ${lost} insectos. Durante 2 rondas no habrá insectos.`,
        "card"
      );
    } else if (card.id === "trash") {
      const lostNut = next.board.nutrients;
      returnToReserve(next, "nutrients", lostNut);
      const speciesLost = [];
      ["plants", "rabbits", "lynx", "insects"].forEach((k) => {
        if (next.board[k] > 0) {
          returnToReserve(next, k, 1);
          speciesLost.push(EcoGame.SPECIES[k].label.toLowerCase());
        }
      });
      addLog(
        next,
        `🃏 Basura: desaparecen ${lostNut} nutrientes y 1 de cada especie (${speciesLost.join(", ") || "ninguna"}).`,
        "card"
      );
    } else if (card.id === "pollution") {
      const lostInsects = next.board.insects;
      const lostPlants = next.board.plants;
      returnToReserve(next, "insects", lostInsects);
      returnToReserve(next, "plants", lostPlants);
      addLog(
        next,
        `🃏 Contaminación: mueren ${lostInsects} insectos y ${lostPlants} plantas.`,
        "card"
      );
    }

    if (!checkSustainability(next)) {
      next.phase = "predict";
    }
    return next;
  }

  function getMaxExchange(state) {
    return Math.min(state.board.insects, state.board.nutrients, state.reserve.plants);
  }

  function ensureArrays(m, board) {
    if (!Array.isArray(m.rabbitProgress) || m.rabbitProgress.length !== board.rabbits) {
      if (!Array.isArray(m.rabbitProgress)) m.rabbitProgress = Array(board.rabbits).fill(0);
    }
    if (!Array.isArray(m.lynxProgress) || m.lynxProgress.length !== board.lynx) {
      if (!Array.isArray(m.lynxProgress)) m.lynxProgress = Array(board.lynx).fill(0);
    }
    if (!Array.isArray(m.insectRecycled) || m.insectRecycled.length !== board.insects) {
      if (!Array.isArray(m.insectRecycled)) m.insectRecycled = Array(board.insects).fill(false);
    }
  }

  function performMove(state, targetZone, mode = "one", sourceZone = null, tokenIndex = null) {
    const next = cloneState(state);
    const m = next.roundMeta;
    ensureArrays(m, next.board);

    if (next.phase === "turn_rabbits") {
      if (mode === "all") {
        // Completa los conejos que aún tienen progreso < 2
        for (let i = 0; i < m.rabbitProgress.length; i++) {
          while (m.rabbitProgress[i] < 2 && next.board.plants > 0) {
            returnToReserve(next, "plants", 1);
            m.rabbitProgress[i] += 1;
          }
        }
        // Si alguno quedó a 1/2 y ya no hay plantas, igual no completó sus 2 plantas -> muere
        const fullRabbits = m.rabbitProgress.filter((v) => v >= 2);
        const starvedCount = m.rabbitProgress.length - fullRabbits.length;
        if (starvedCount > 0) {
          returnToReserve(next, "rabbits", starvedCount);
          if (next.variant === "balanced") m.pendingRemains += starvedCount;
        }
        m.rabbitProgress = fullRabbits;
        m.fedRabbits = fullRabbits.length;
        addLog(
          next,
          starvedCount > 0
            ? `🐇 ${fullRabbits.length} conejo(s) comen 2 plantas. 💀 ${starvedCount} muere(n) por falta de plantas.`
            : `🐇 Cada uno de los ${fullRabbits.length} conejos come sus 2 plantas.`,
          starvedCount > 0 ? "warn" : "good"
        );
        if (!checkSustainability(next)) enterTurnLynx(next);
        return { state: next };
      }

      if (next.board.rabbits === 0) {
        enterTurnLynx(next);
        return { state: next };
      }

      // Elegir índice de conejo: el arrastrado, o si clicó planta, uno con 1/2 o 0/2
      let idx =
        typeof tokenIndex === "number" && tokenIndex >= 0 && tokenIndex < m.rabbitProgress.length
          ? tokenIndex
          : m.rabbitProgress.findIndex((v) => v === 1);
      if (idx === -1) idx = m.rabbitProgress.findIndex((v) => v === 0);

      if (idx === -1) {
        if (!checkSustainability(next)) enterTurnLynx(next);
        return { state: next };
      }

      // ¿Este conejo específico ya comió sus 2 plantas?
      if (m.rabbitProgress[idx] >= 2) {
        return {
          error: `🚫 ¡El conejo #${idx + 1} ya comió sus 2 plantas! Mueve otro conejo que aún tenga hambre.`,
        };
      }

      const needForThis = 2 - m.rabbitProgress[idx];
      const hasEnoughForAny = next.board.plants >= needForThis || (m.rabbitProgress[idx] === 1 && next.board.plants >= 1);

      // Si se arrastra un conejo sin comida posible a la Caja Reserva
      if (targetZone === "reserve" && (!sourceZone || sourceZone === "rabbits")) {
        if (next.board.plants >= 2 || (m.rabbitProgress[idx] === 1 && next.board.plants >= 1)) {
          return { error: "🌱 ¡Todavía hay plantas para este conejo! Arrástralo sobre una Planta (🌱)." };
        }
        returnToReserve(next, "rabbits", 1);
        m.rabbitProgress.splice(idx, 1);
        if (next.variant === "balanced") m.pendingRemains += 1;
        addLog(next, `💀 1 conejo muere por falta de plantas y vuelve a la Reserva.`, "warn");
        if (m.rabbitProgress.every((v) => v >= 2)) {
          if (!checkSustainability(next)) enterTurnLynx(next);
        }
        return { state: next, floater: "💀 -1 🐇" };
      }

      const validEat =
        targetZone === "plants" || (sourceZone === "plants" && targetZone === "reserve");
      if (!validEat) {
        return {
          error:
            next.board.plants > 0
              ? "🚫 Los Conejos son herbívoros: ¡arrastra este conejo sobre una Planta (🌱)!"
              : "💀 No quedan plantas: arrastra los conejos hambrientos a la 📦 Caja Reserva.",
        };
      }

      if (next.board.plants === 0) {
        return {
          error: "💀 No quedan plantas suficientes (necesita 2): arrastra los conejos restantes a la 📦 Caja Reserva.",
        };
      }

      returnToReserve(next, "plants", 1);
      m.rabbitProgress[idx] += 1;
      let floater = `🐇 #${idx + 1}: ${m.rabbitProgress[idx]}/2 🌱`;
      if (m.rabbitProgress[idx] >= 2) {
        floater = `✅ Conejo #${idx + 1} lleno (2/2)`;
        addLog(next, `🐇 El conejo #${idx + 1} ya ha comido sus 2 plantas.`, "good");
      }

      if (m.rabbitProgress.every((v) => v >= 2)) {
        if (!checkSustainability(next)) enterTurnLynx(next);
      }
      return { state: next, floater };
    }

    if (next.phase === "turn_lynx") {
      if (mode === "all") {
        for (let i = 0; i < m.lynxProgress.length; i++) {
          while (m.lynxProgress[i] < 2 && next.board.rabbits > 0) {
            returnToReserve(next, "rabbits", 1);
            m.pendingRemains += 1;
            m.lynxProgress[i] += 1;
          }
        }
        const fullLynx = m.lynxProgress.filter((v) => v >= 2);
        const starvedCount = m.lynxProgress.length - fullLynx.length;
        if (starvedCount > 0) {
          returnToReserve(next, "lynx", starvedCount);
        }
        m.lynxProgress = fullLynx;
        m.fedLynx = fullLynx.length;
        m.fedRabbits = next.board.rabbits;
        addLog(
          next,
          starvedCount > 0
            ? `🐆 ${fullLynx.length} lince(s) cazan. 💀 ${starvedCount} muere(n) por falta de conejos.`
            : `🐆 Cada lince (${fullLynx.length}) caza sus 2 conejos.`,
          starvedCount > 0 ? "warn" : "info"
        );
        if (!checkSustainability(next)) next.phase = "turn_remains";
        return { state: next };
      }

      if (next.board.lynx === 0) {
        next.phase = "turn_remains";
        return { state: next };
      }

      let idx =
        typeof tokenIndex === "number" && tokenIndex >= 0 && tokenIndex < m.lynxProgress.length
          ? tokenIndex
          : m.lynxProgress.findIndex((v) => v === 1);
      if (idx === -1) idx = m.lynxProgress.findIndex((v) => v === 0);

      if (idx === -1) {
        if (!checkSustainability(next)) next.phase = "turn_remains";
        return { state: next };
      }

      if (m.lynxProgress[idx] >= 2) {
        return {
          error: `🚫 ¡El lince #${idx + 1} ya cazó sus 2 conejos! Si hay otro lince, muévelo a él.`,
        };
      }

      if (targetZone === "reserve" && (!sourceZone || sourceZone === "lynx")) {
        if (next.board.rabbits >= 2 || (m.lynxProgress[idx] === 1 && next.board.rabbits >= 1)) {
          return { error: "🐇 ¡Todavía hay conejos! Arrastra el Lince sobre un Conejo para cazar." };
        }
        returnToReserve(next, "lynx", 1);
        m.lynxProgress.splice(idx, 1);
        addLog(next, "💀 1 lince muere por falta de conejos y vuelve a la Reserva.", "warn");
        if (m.lynxProgress.every((v) => v >= 2)) {
          m.fedLynx = m.lynxProgress.length;
          m.fedRabbits = next.board.rabbits;
          if (!checkSustainability(next)) next.phase = "turn_remains";
        }
        return { state: next, floater: "💀 -1 🐆" };
      }

      const validHunt =
        targetZone === "rabbits" || (sourceZone === "rabbits" && targetZone === "lynx");
      if (!validHunt) {
        return {
          error:
            next.board.rabbits > 0
              ? "🚫 El Lince es carnívoro: ¡solo puede cazar Conejos (🐇)!"
              : "💀 No hay conejos suficientes: arrastra el Lince a la 📦 Caja Reserva.",
        };
      }

      if (next.board.rabbits === 0) {
        return { error: "💀 No quedan conejos suficientes (necesita 2): arrastra el Lince a la 📦 Caja Reserva." };
      }

      returnToReserve(next, "rabbits", 1);
      m.pendingRemains += 1;
      m.lynxProgress[idx] += 1;
      m.fedRabbits = next.board.rabbits;
      let floater = `🐆 #${idx + 1}: ${m.lynxProgress[idx]}/2 🐇`;
      if (m.lynxProgress[idx] >= 2) {
        floater = `✅ Lince #${idx + 1} lleno (2/2)`;
        addLog(next, `🐆 El lince #${idx + 1} ya ha cazado sus 2 conejos.`, "info");
      }

      if (m.lynxProgress.every((v) => v >= 2)) {
        m.fedLynx = m.lynxProgress.length;
        m.fedRabbits = next.board.rabbits;
        if (!checkSustainability(next)) next.phase = "turn_remains";
      }
      return { state: next, floater };
    }

    if (next.phase === "turn_remains") {
      if (m.pendingRemains === 0) {
        addLog(next, "🦴 No hay nuevos restos orgánicos que colocar en el centro.", "info");
        enterTurnInsects(next);
        return { state: next };
      }
      if (targetZone !== "remains" && targetZone !== "center") {
        return { error: "🚫 Arrastra las fichas grises (🦴) hasta la zona de Restos en el círculo central." };
      }
      const count = mode === "all" ? m.pendingRemains : 1;
      const placed = takeFromReserve(next, "remains", count);
      m.pendingRemains = Math.max(0, m.pendingRemains - count);
      addLog(next, `🦴 Se coloca(n) ${placed} resto(s) orgánico(s) en el centro.`, "info");
      if (m.pendingRemains === 0) {
        enterTurnInsects(next);
      }
      return { state: next, floater: `+${placed} 🦴` };
    }

    if (next.phase === "turn_insects") {
      const remainingInsects = m.insectRecycled.filter((done) => !done).length;
      if (next.board.insects === 0 || next.board.remains === 0 || remainingInsects === 0) {
        if (next.board.remains > 0 && next.board.insects === 0) {
          addLog(next, `🦴 Quedan ${next.board.remains} restos sin reciclar por falta de insectos.`, "warn");
        } else {
          addLog(next, "🐞 Reciclaje de insectos completado.", "info");
        }
        next.phase = "turn_nutrients";
        return { state: next };
      }

      const validRecycle =
        targetZone === "remains" || (sourceZone === "remains" && targetZone === "insects");
      if (!validRecycle) {
        return { error: "🚫 Los Insectos descomponedores solo reciclan Restos orgánicos (🦴)." };
      }

      if (mode === "all") {
        let count = 0;
        for (let i = 0; i < m.insectRecycled.length && next.board.remains > 0; i++) {
          if (!m.insectRecycled[i]) {
            m.insectRecycled[i] = true;
            returnToReserve(next, "remains", 1);
            m.pendingNutrients += 2;
            count += 1;
          }
        }
        if (count > 0) {
          addLog(
            next,
            `♻️ ${count} insecto(s) descomponen ${count} resto(s) → +${count * 2} nutrientes pendientes.`,
            "good"
          );
        }
        next.phase = "turn_nutrients";
        return { state: next, floater: `+${count * 2} 🪱` };
      }

      let idx =
        typeof tokenIndex === "number" && tokenIndex >= 0 && tokenIndex < m.insectRecycled.length
          ? tokenIndex
          : m.insectRecycled.findIndex((done) => !done);

      if (idx === -1) {
        next.phase = "turn_nutrients";
        return { state: next };
      }

      if (m.insectRecycled[idx]) {
        return {
          error: `🚫 ¡El insecto #${idx + 1} ya descompuso 1 resto orgánico! Mueve otro insecto.`,
        };
      }

      m.insectRecycled[idx] = true;
      returnToReserve(next, "remains", 1);
      m.pendingNutrients += 2;
      addLog(next, `♻️ Insecto #${idx + 1} descompone 1 resto orgánico (+2 nutrientes pendientes).`, "good");

      if (m.insectRecycled.every((done) => done) || next.board.remains === 0) {
        next.phase = "turn_nutrients";
      }
      return { state: next, floater: `🐞 #${idx + 1}: +2 🪱` };
    }

    if (next.phase === "turn_nutrients") {
      if (mode === "all") {
        if (m.pendingNutrients > 0) {
          const added = takeFromReserve(next, "nutrients", m.pendingNutrients);
          m.pendingNutrients = 0;
          addLog(next, `🪱 Suelo recoge +${added} nutrientes del reciclaje.`, "good");
        }
        const maxEx = getMaxExchange(next);
        m.nutrientsSentToPlants = Math.max(m.nutrientsSentToPlants, maxEx);
        enterTurnPlants(next);
        return { state: next };
      }

      if (m.pendingNutrients > 0) {
        if (targetZone !== "nutrients") {
          return { error: "🪱 Primero recoge los nutrientes nuevos de la bandeja arrastrándolos a la Zona Suelo." };
        }
        const added = takeFromReserve(next, "nutrients", 1);
        m.pendingNutrients = Math.max(0, m.pendingNutrients - 1);
        if (added === 0) m.pendingNutrients = 0;
        addLog(next, `🪱 +${added} nutriente colocado en la Zona Suelo.`, "good");
        return { state: next, floater: `+${added} 🪱` };
      }

      if (targetZone !== "plants") {
        return { error: "🚫 Arrastra 1 Nutriente (🪱) desde el Suelo hasta la Zona Plantas (🌱) para fertilizar." };
      }
      const maxEx = getMaxExchange(next);
      if (typeof tokenIndex === "number" && tokenIndex < m.nutrientsSentToPlants) {
        return { error: "🚫 Ese nutriente ya está asignado a Plantas. Arrastra otro nutriente del Suelo." };
      }
      if (m.nutrientsSentToPlants < maxEx) {
        m.nutrientsSentToPlants += 1;
        addLog(next, `🪱 +1 nutriente enviado a Plantas (${m.nutrientsSentToPlants}/${maxEx}).`, "info");
      } else {
        return { error: `🚫 Límite alcanzado: máximo 1 nutriente por cada insecto vivo (${maxEx}).` };
      }
      if (m.nutrientsSentToPlants >= maxEx) {
        enterTurnPlants(next);
      }
      return { state: next, floater: "🌱 Fertilizado" };
    }

    if (next.phase === "turn_plants") {
      if (targetZone !== "plants") {
        return { error: "🚫 Arrastra las nuevas Plantas (🌱) de la bandeja a la Zona Plantas." };
      }
      if (m.plantsToSprout > 0) {
        const count = mode === "all" ? m.plantsToSprout : 1;
        const gained = takeFromReserve(next, "plants", count);
        m.plantsToSprout = Math.max(0, m.plantsToSprout - count);
        if (gained === 0) m.plantsToSprout = 0;
        addLog(next, `🌱 Brotan +${gained} planta(s) en la zona productores.`, "good");
      }
      if (m.plantsToSprout === 0) {
        finalizePlantsAndBirths(next);
      }
      return { state: next, floater: "+1 🌱" };
    }

    return { state: next };
  }

  function advanceTurnWithPass(state) {
    const next = cloneState(state);
    if (next.phase === "turn_rabbits") return performMove(next, "plants", "all").state;
    if (next.phase === "turn_lynx") return performMove(next, "rabbits", "all").state;
    if (next.phase === "turn_remains") return performMove(next, "remains", "all").state;
    if (next.phase === "turn_insects") {
      next.phase = "turn_nutrients";
      return next;
    }
    if (next.phase === "turn_nutrients") {
      if (next.roundMeta.pendingNutrients > 0) {
        takeFromReserve(next, "nutrients", next.roundMeta.pendingNutrients);
        next.roundMeta.pendingNutrients = 0;
      }
      enterTurnPlants(next);
      return next;
    }
    if (next.phase === "turn_plants") return performMove(next, "plants", "all").state;
    return next;
  }

  function advanceRound(state) {
    const next = cloneState(state);
    if (next.round >= next.maxRounds || next.collapsed) {
      next.status = "finished";
      return next;
    }
    next.round += 1;
    if (next.noInsectsRoundsLeft > 0) {
      next.noInsectsRoundsLeft -= 1;
    }
    next.predictions = {};
    resetRoundMeta(next);

    if (next.round === 3) {
      next.phase = "card";
      addLog(next, "🃏 ¡Inicio de la Ronda 3! Toca robar una Carta del Ecosistema.", "card");
    } else {
      next.phase = "predict";
      addLog(next, `➡️ Comienza la Ronda ${next.round}.`, "info");
    }
    return next;
  }

  function triggerExtraCardRound(state) {
    const next = cloneState(state);
    next.phase = "card";
    return next;
  }

  function finishGameEarly(state) {
    const next = cloneState(state);
    next.pendingCard = null;
    next.status = "finished";
    return next;
  }

  function analyzeEcosystem(state) {
    const b = state.board;
    const insights = [];
    const missing = LIVING_KEYS.filter((k) => b[k] <= 0);
    const collapsed = state.collapsed || missing.length >= 2;

    if (state.collapsed && state.collapseReason) {
      insights.push(state.collapseReason);
    }
    if (b.insects === 0) {
      insights.push(
        "Sin insectos descomponedores ni polinizadores, los restos orgánicos se acumulan (" +
          b.remains +
          " en el centro) y dejan de convertirse en nutrientes para nuevas plantas."
      );
    }
    if (b.plants === 0) {
      insights.push(
        "Sin plantas (productores), la base alimentaria desaparece y provoca la caída en cascada de herbívoros y depredadores."
      );
    }
    if (b.lynx === 0 && b.rabbits > 0) {
      insights.push(
        "Sin linces ibéricos, nadie regula a los conejos, que consumen las plantas más rápido de lo que el suelo puede regenerarlas."
      );
    }
    if (!collapsed && missing.length === 0) {
      insights.push(
        "¡Vuestro ecosistema ha mantenido representación en todas las especies hasta el final! Aun así, podéis observar en la gráfica el equilibrio dinámico."
      );
    }
    if (state.activeCard) {
      insights.push(
        `La carta "${state.activeCard.title}" (${state.activeCard.effectText}) demostró que alterar una pieza afecta a toda la red trófica.`
      );
    }
    return { collapsed, insights };
  }

  EcoGame.engine = {
    ROLE_ORDER,
    LIVING_KEYS,
    createInitialState,
    cloneState,
    startGame,
    getActivePhaseRole,
    getTurnOwner,
    checkSustainability,
    submitPrediction,
    finishPredict,
    drawEcosystemCard,
    applyPendingCard,
    getMaxExchange,
    performMove,
    advanceTurnWithPass,
    advanceRound,
    triggerExtraCardRound,
    finishGameEarly,
    analyzeEcosystem,
  };
})(window);
