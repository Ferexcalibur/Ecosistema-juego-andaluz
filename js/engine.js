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
      status: "lobby", // 'lobby' | 'playing' | 'finished'
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
        rabbitsMoved: 0,
        fedRabbits: 0,
        lynxMoved: 0,
        fedLynx: 0,
        pendingRemains: 0,
        remainsRecycled: 0,
        pendingNutrients: 0,
        nutrientsCollected: false,
        nutrientsSentToPlants: 0,
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
    // Eliminar bots previos si se reinicia
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
      rabbitsMoved: 0,
      fedRabbits: 0,
      lynxMoved: 0,
      fedLynx: 0,
      pendingRemains: 0,
      remainsRecycled: 0,
      pendingNutrients: 0,
      nutrientsCollected: false,
      nutrientsSentToPlants: 0,
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
      state.phase = "round_end";
      state.status = "finished";
      return true;
    }
    return false;
  }

  function enterTurnInsects(state) {
    state.phase = "turn_insects";
    // Comprobar supervivencia de insectos según las plantas al inicio de la ronda
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
    checkSustainability(state);
  }

  function enterTurnNutrients(state) {
    state.phase = "turn_nutrients";
    if (state.roundMeta.pendingNutrients > 0) {
      const added = takeFromReserve(state, "nutrients", state.roundMeta.pendingNutrients);
      state.roundMeta.pendingNutrients = 0;
      state.roundMeta.nutrientsCollected = true;
      addLog(state, `🪱 La zona suelo recibe +${added} nutrientes del reciclaje.`, "good");
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
    if (!card) return next;

    next.activeCard = { ...card, drawnRound: next.round };
    next.pendingCard = null;

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

  // Movimiento interactivo por turno (valida dieta/objetivo de cada ficha)
  function performMove(state, targetZone, mode = "one") {
    const next = cloneState(state);
    const meta = next.roundMeta;

    if (next.phase === "turn_rabbits") {
      if (targetZone !== "plants") {
        return { error: "🚫 ¡Movimiento no válido! Los Conejos son herbívoros y solo pueden comer Plantas (🌱)." };
      }
      if (next.board.rabbits === 0) {
        addLog(next, "🐇 No quedan conejos que alimentar.", "info");
        next.phase = "turn_lynx";
        return { state: next };
      }

      if (mode === "all") {
        const remaining = next.board.rabbits - meta.rabbitsMoved;
        const canFeed = Math.min(remaining, Math.floor(next.board.plants / 2));
        const starved = remaining - canFeed;
        if (canFeed > 0) {
          returnToReserve(next, "plants", canFeed * 2);
          meta.fedRabbits += canFeed;
          meta.rabbitsMoved += canFeed;
        }
        if (starved > 0) {
          returnToReserve(next, "rabbits", starved);
          if (next.variant === "balanced") meta.pendingRemains += starved;
        }
        addLog(
          next,
          starved > 0
            ? `🐇 Conejos comen ${canFeed * 2} plantas. 💀 ${starved} conejo(s) mueren por falta de comida.`
            : `🐇 ${canFeed} conejo(s) comen ${canFeed * 2} plantas y sobreviven.`,
          starved > 0 ? "warn" : "good"
        );
        if (!checkSustainability(next)) next.phase = "turn_lynx";
        return { state: next };
      }

      // 1 movimiento individual
      if (next.board.plants >= 2 && meta.rabbitsMoved < next.board.rabbits) {
        returnToReserve(next, "plants", 2);
        meta.fedRabbits += 1;
        meta.rabbitsMoved += 1;
        addLog(next, `🐇 1 conejo come 2 plantas (${meta.rabbitsMoved}/${next.board.rabbits}).`, "good");
      } else {
        const starved = Math.max(0, next.board.rabbits - meta.rabbitsMoved);
        if (starved > 0) {
          returnToReserve(next, "rabbits", starved);
          if (next.variant === "balanced") meta.pendingRemains += starved;
          addLog(next, `💀 No quedan suficientes plantas: mueren ${starved} conejo(s).`, "warn");
        }
      }

      // Si todos los conejos vivos ya comieron o no hay plantas para el siguiente, resolver restantes y pasar turno
      if (meta.rabbitsMoved >= next.board.rabbits || next.board.plants < 2) {
        const starvedLeft = Math.max(0, next.board.rabbits - meta.rabbitsMoved);
        if (starvedLeft > 0) {
          returnToReserve(next, "rabbits", starvedLeft);
          if (next.variant === "balanced") meta.pendingRemains += starvedLeft;
          addLog(next, `💀 Se acabaron las plantas: mueren ${starvedLeft} conejo(s) restantes.`, "warn");
        }
        if (!checkSustainability(next)) next.phase = "turn_lynx";
      }
      return { state: next };
    }

    if (next.phase === "turn_lynx") {
      if (targetZone !== "rabbits") {
        return { error: "🚫 ¡Movimiento no válido! El Lince ibérico solo puede cazar Conejos (🐇)." };
      }
      if (next.board.lynx === 0) {
        addLog(next, "🐆 No hay linces en el tablero.", "info");
        next.phase = "turn_remains";
        return { state: next };
      }

      if (mode === "all") {
        const remaining = next.board.lynx - meta.lynxMoved;
        const canHunt = Math.min(remaining, Math.floor(next.board.rabbits / 2));
        const starved = remaining - canHunt;
        if (canHunt > 0) {
          const hunted = canHunt * 2;
          returnToReserve(next, "rabbits", hunted);
          meta.pendingRemains += hunted;
          meta.fedRabbits = Math.max(0, meta.fedRabbits - hunted);
          meta.fedLynx += canHunt;
          meta.lynxMoved += canHunt;
        }
        if (starved > 0) {
          returnToReserve(next, "lynx", starved);
        }
        addLog(
          next,
          starved > 0
            ? `🐆 ${canHunt} lince(s) cazan ${canHunt * 2} conejos. 💀 ${starved} lince(s) mueren por falta de presas.`
            : `🐆 ${canHunt} lince(s) cazan ${canHunt * 2} conejos (quedan pendientes para Restos orgánicos).`,
          starved > 0 ? "warn" : "info"
        );
        if (!checkSustainability(next)) next.phase = "turn_remains";
        return { state: next };
      }

      if (next.board.rabbits >= 2 && meta.lynxMoved < next.board.lynx) {
        returnToReserve(next, "rabbits", 2);
        meta.pendingRemains += 2;
        meta.fedRabbits = Math.max(0, meta.fedRabbits - 2);
        meta.fedLynx += 1;
        meta.lynxMoved += 1;
        addLog(next, `🐆 1 lince caza 2 conejos (${meta.lynxMoved}/${next.board.lynx}).`, "info");
      }

      if (meta.lynxMoved >= next.board.lynx || next.board.rabbits < 2) {
        const starvedLeft = Math.max(0, next.board.lynx - meta.lynxMoved);
        if (starvedLeft > 0) {
          returnToReserve(next, "lynx", starvedLeft);
          addLog(next, `💀 No hay suficientes conejos: mueren ${starvedLeft} lince(s).`, "warn");
        }
        if (!checkSustainability(next)) next.phase = "turn_remains";
      }
      return { state: next };
    }

    if (next.phase === "turn_remains") {
      if (targetZone !== "remains" && targetZone !== "center") {
        return { error: "🚫 ¡Movimiento no válido! Los Restos orgánicos (🦴) se colocan en su zona del círculo central." };
      }
      if (meta.pendingRemains > 0) {
        const placed = takeFromReserve(next, "remains", meta.pendingRemains);
        meta.pendingRemains = 0;
        addLog(next, `🦴 Restos orgánicos coloca ${placed} ficha(s) gris(es) en el centro.`, "info");
      } else {
        addLog(next, "🦴 No hay nuevos restos orgánicos que colocar en esta ronda.", "info");
      }
      enterTurnInsects(next);
      return { state: next };
    }

    if (next.phase === "turn_insects") {
      if (targetZone !== "remains") {
        return { error: "🚫 ¡Movimiento no válido! Los Insectos descomponedores solo pueden reciclar Restos orgánicos (🦴)." };
      }
      if (next.board.insects === 0 || next.board.remains === 0) {
        if (next.board.remains > 0 && next.board.insects === 0) {
          addLog(next, `🦴 Quedan ${next.board.remains} restos sin reciclar por falta de insectos.`, "warn");
        } else {
          addLog(next, "🐞 No hay restos orgánicos que reciclar.", "info");
        }
        enterTurnNutrients(next);
        return { state: next };
      }

      if (mode === "all") {
        const canDo = Math.min(next.board.insects - meta.remainsRecycled, next.board.remains);
        if (canDo > 0) {
          returnToReserve(next, "remains", canDo);
          meta.remainsRecycled += canDo;
          meta.pendingNutrients += canDo * 2;
          addLog(
            next,
            `♻️ ${canDo} insecto(s) descomponen ${canDo} resto(s) orgánico(s) → generan ${canDo * 2} nutrientes.`,
            "good"
          );
        }
        enterTurnNutrients(next);
        return { state: next };
      }

      if (meta.remainsRecycled < next.board.insects && next.board.remains > 0) {
        returnToReserve(next, "remains", 1);
        meta.remainsRecycled += 1;
        meta.pendingNutrients += 2;
        addLog(next, `♻️ 1 insecto descompone 1 resto orgánico (+2 nutrientes pendientes).`, "good");
      }

      if (meta.remainsRecycled >= next.board.insects || next.board.remains === 0) {
        enterTurnNutrients(next);
      }
      return { state: next };
    }

    if (next.phase === "turn_nutrients") {
      if (targetZone !== "plants") {
        return { error: "🚫 ¡Movimiento no válido! Los Nutrientes (🪱) se envían a la Zona Plantas (🌱) para que broten." };
      }
      const maxEx = Math.min(next.board.insects, next.board.nutrients, next.reserve.plants);
      if (mode === "all") {
        // Bot o completar: envía todos los posibles (hasta maxEx) y pasa a Plantas
        const toSend = Math.max(0, maxEx - meta.nutrientsSentToPlants);
        if (toSend > 0) {
          meta.nutrientsSentToPlants += toSend;
        }
        addLog(
          next,
          meta.nutrientsSentToPlants > 0
            ? `🪱 Nutrientes envía ${meta.nutrientsSentToPlants} nutriente(s) a Zona Plantas.`
            : "🪱 No se pudieron enviar nutrientes a Plantas en esta ronda.",
          meta.nutrientsSentToPlants > 0 ? "good" : "info"
        );
        next.phase = "turn_plants";
        return { state: next };
      }

      if (meta.nutrientsSentToPlants < maxEx) {
        meta.nutrientsSentToPlants += 1;
        addLog(next, `🪱 Preparado +1 nutriente para plantar (${meta.nutrientsSentToPlants}/${maxEx}).`, "info");
      }
      if (meta.nutrientsSentToPlants >= maxEx) {
        next.phase = "turn_plants";
      }
      return { state: next };
    }

    if (next.phase === "turn_plants") {
      if (targetZone !== "plants") {
        return { error: "🚫 ¡Movimiento no válido! Haz clic en tu propia Zona Plantas (🌱) para hacerlas brotar." };
      }

      const sendCount = Math.min(
        meta.nutrientsSentToPlants,
        next.board.nutrients,
        next.reserve.plants
      );
      if (sendCount > 0) {
        returnToReserve(next, "nutrients", sendCount);
        const yieldPer = next.variant === "balanced" ? 2 : 1;
        const gained = takeFromReserve(next, "plants", sendCount * yieldPer);
        addLog(next, `🌱 Brotan +${gained} planta(s) usando ${sendCount} nutriente(s).`, "good");
      } else {
        addLog(next, "🌱 No brotan nuevas plantas en esta ronda.", "info");
      }

      if (next.variant === "balanced" && next.board.plants > 0 && next.board.insects > 0) {
        const bonus = takeFromReserve(next, "plants", 2);
        if (bonus > 0) {
          addLog(next, `☀️ Polinización y sol (variante equilibrada): +${bonus} plantas extra.`, "good");
        }
      }

      // Nacimientos de especies al finalizar el crecimiento
      const newRabbits = takeFromReserve(next, "rabbits", Math.floor(meta.fedRabbits / 2));
      const newLynx = takeFromReserve(
        next,
        "lynx",
        Math.min(Math.floor(meta.fedLynx / 2), Math.floor(meta.fedRabbits / 4))
      );
      let newInsects = 0;
      if (next.noInsectsRoundsLeft === 0 && next.board.insects >= 1) {
        const room = Math.max(0, 5 - next.board.insects);
        newInsects = takeFromReserve(next, "insects", Math.min(Math.floor(next.board.plants / 8), room));
      }

      const births = [];
      if (newRabbits > 0) births.push(`+${newRabbits} conejo(s)`);
      if (newLynx > 0) births.push(`+${newLynx} lince(s)`);
      if (newInsects > 0) births.push(`+${newInsects} insecto(s)`);
      if (births.length > 0) {
        addLog(next, `🐣 Nacimientos: ${births.join(", ")}.`, "good");
      }

      if (!checkSustainability(next)) {
        next.history.push({
          round: next.round,
          label: `Ronda ${next.round}`,
          ...next.board,
          card: next.activeCard && next.activeCard.drawnRound === next.round ? next.activeCard.title : null,
        });
        next.phase = "round_end";
      }
      return { state: next };
    }

    return { state: next };
  }

  function advanceTurnWithPass(state) {
    // Permite pasar turno manualmente cuando el jugador ya hizo suficientes movimientos (ej. nutrientes parcial o sin comida)
    const next = cloneState(state);
    if (next.phase === "turn_rabbits") {
      return performMove(next, "plants", "all").state;
    }
    if (next.phase === "turn_lynx") {
      return performMove(next, "rabbits", "all").state;
    }
    if (next.phase === "turn_remains") {
      return performMove(next, "remains", "all").state;
    }
    if (next.phase === "turn_insects") {
      enterTurnNutrients(next);
      return next;
    }
    if (next.phase === "turn_nutrients") {
      next.phase = "turn_plants";
      addLog(
        next,
        next.roundMeta.nutrientsSentToPlants > 0
          ? `🪱 Nutrientes envía ${next.roundMeta.nutrientsSentToPlants} nutriente(s) a Plantas.`
          : "🪱 Nutrientes pasa el turno a Plantas sin envíos.",
        "info"
      );
      return next;
    }
    if (next.phase === "turn_plants") {
      return performMove(next, "plants", "all").state;
    }
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
