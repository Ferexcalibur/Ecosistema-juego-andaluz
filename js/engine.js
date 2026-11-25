(function (global) {
  const EcoGame = (global.EcoGame = global.EcoGame || {});

  function createInitialState(config) {
    const ecosystem = config.ecosystem || "donana";
    const variant = config.variant || "classic";
    const maxRounds = config.maxRounds || 5;
    const roleLock = Boolean(config.roleLock);

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
      roleLock,
      maxRounds,
      round: 1,
      phase: "predict",
      board: { ...initialBoard },
      reserve: { ...initialReserve },
      roundMeta: {
        plantsAtFeedStart: initialBoard.plants,
        fedRabbits: 0,
        fedLynx: 0,
        exchangedCount: 0,
      },
      activeCard: null,
      pendingCard: null,
      noInsectsRoundsLeft: 0,
      predictions: {}, // { playerId: 'up' | 'down' | 'stable' | 'collapse' }
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
    if (state.logs.length > 60) state.logs.length = 60;
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

  function startGame(state) {
    const next = cloneState(state);
    next.status = "playing";
    next.round = 1;
    next.phase = "predict";
    next.predictions = {};
    next.roundMeta = {
      plantsAtFeedStart: next.board.plants,
      fedRabbits: 0,
      fedLynx: 0,
      exchangedCount: 0,
    };
    addLog(next, "¡Comienza la simulación del ecosistema en la Ronda 1!", "good");
    return next;
  }

  function getActivePhaseRole(phase) {
    switch (phase) {
      case "feed_rabbits":
        return "rabbits";
      case "feed_lynx":
        return "lynx";
      case "feed_insects":
      case "recycle":
        return "center";
      case "growth_exchange":
        return "nutrients";
      case "growth_repro":
        return "plants";
      default:
        return null; // Cualquier jugador o anfitrión
    }
  }

  function submitPrediction(state, playerId, playerName, choice) {
    const next = cloneState(state);
    next.predictions[playerId] = { name: playerName, choice };
    return next;
  }

  function finishPredict(state) {
    const next = cloneState(state);
    next.roundMeta.plantsAtFeedStart = next.board.plants;
    next.roundMeta.fedRabbits = 0;
    next.roundMeta.fedLynx = 0;
    next.roundMeta.exchangedCount = 0;
    next.phase = "feed_rabbits";
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

    next.phase = "predict";
    return next;
  }

  function runFeedRabbits(state) {
    const next = cloneState(state);
    const totalRabbits = next.board.rabbits;
    if (totalRabbits === 0) {
      next.roundMeta.fedRabbits = 0;
      addLog(next, "🐇 No hay conejos que alimentar en esta ronda.", "info");
    } else {
      const canFeed = Math.min(totalRabbits, Math.floor(next.board.plants / 2));
      const starved = totalRabbits - canFeed;
      const eatenPlants = canFeed * 2;
      returnToReserve(next, "plants", eatenPlants);
      returnToReserve(next, "rabbits", starved);
      if (next.variant === "balanced" && starved > 0) {
        takeFromReserve(next, "remains", starved);
      }
      next.roundMeta.fedRabbits = canFeed;
      if (starved > 0) {
        addLog(
          next,
          `🐇 ${canFeed} conejo(s) comen ${eatenPlants} plantas. 💀 ${starved} conejo(s) mueren por falta de comida.`,
          "warn"
        );
      } else {
        addLog(next, `🐇 Los ${canFeed} conejos comen ${eatenPlants} plantas y sobreviven.`, "good");
      }
    }
    next.phase = "feed_lynx";
    return next;
  }

  function runFeedLynx(state) {
    const next = cloneState(state);
    const totalLynx = next.board.lynx;
    if (totalLynx === 0) {
      next.roundMeta.fedLynx = 0;
      addLog(next, "🐆 No hay linces en el tablero.", "info");
    } else {
      const canFeed = Math.min(totalLynx, Math.floor(next.board.rabbits / 2));
      const starved = totalLynx - canFeed;
      const huntedRabbits = canFeed * 2;
      returnToReserve(next, "rabbits", huntedRabbits);
      const remainsAdded = takeFromReserve(next, "remains", huntedRabbits);
      next.roundMeta.fedRabbits = Math.max(0, next.roundMeta.fedRabbits - huntedRabbits);
      if (starved > 0) {
        returnToReserve(next, "lynx", starved);
      }
      next.roundMeta.fedLynx = canFeed;
      if (starved > 0) {
        addLog(
          next,
          `🐆 ${canFeed} lince(s) cazan ${huntedRabbits} conejos (→ ${remainsAdded} restos grises). 💀 ${starved} lince(s) mueren por falta de presas.`,
          "warn"
        );
      } else {
        addLog(
          next,
          `🐆 ${canFeed} lince(s) cazan ${huntedRabbits} conejos y dejan ${remainsAdded} restos orgánicos en el centro.`,
          "info"
        );
      }
    }
    next.phase = "feed_insects";
    return next;
  }

  function runFeedInsects(state) {
    const next = cloneState(state);
    const totalInsects = next.board.insects;
    const plantsRef = next.roundMeta.plantsAtFeedStart;
    if (totalInsects === 0) {
      addLog(next, "🐞 No hay insectos vivos en el centro del tablero.", "warn");
    } else {
      const supported = Math.min(totalInsects, Math.floor(plantsRef / 3));
      const died = totalInsects - supported;
      if (died > 0) {
        returnToReserve(next, "insects", died);
        addLog(
          next,
          `🐞 Había ${plantsRef} plantas al inicio de la fase (3 por insecto): sobreviven ${supported} insectos y mueren ${died}.`,
          "warn"
        );
      } else {
        addLog(
          next,
          `🐞 Los ${supported} insectos tienen suficientes plantas (≥ ${supported * 3} al inicio) y sobreviven.`,
          "good"
        );
      }
    }
    next.phase = "recycle";
    return next;
  }

  function runRecycle(state) {
    const next = cloneState(state);
    const insects = next.board.insects;
    const remains = next.board.remains;
    if (insects === 0 || remains === 0) {
      if (remains > 0 && insects === 0) {
        addLog(
          next,
          `🦴 Hay ${remains} restos orgánicos sin reciclar porque no quedan insectos descomponedores.`,
          "warn"
        );
      } else {
        addLog(next, "♻️ No hay restos orgánicos que descomponer en esta ronda.", "info");
      }
    } else {
      const processed = Math.min(insects, remains);
      returnToReserve(next, "remains", processed);
      const nutrientsCreated = takeFromReserve(next, "nutrients", processed * 2);
      addLog(
        next,
        `♻️ ${processed} insecto(s) descomponen ${processed} resto(s) orgánico(s) y crean +${nutrientsCreated} nutrientes.`,
        "good"
      );
    }
    next.phase = "growth_exchange";
    return next;
  }

  function getMaxExchange(state) {
    return Math.min(state.board.insects, state.board.nutrients, state.reserve.plants);
  }

  function runGrowthExchange(state, exchangeCount) {
    const next = cloneState(state);
    const maxEx = getMaxExchange(next);
    const count = Math.max(0, Math.min(Number(exchangeCount) || 0, maxEx));
    if (count > 0) {
      returnToReserve(next, "nutrients", count);
      const plantYield = next.variant === "balanced" ? count * 2 : count;
      const gained = takeFromReserve(next, "plants", plantYield);
      next.roundMeta.exchangedCount = count;
      addLog(
        next,
        `🌱 Intercambio: ${count} nutriente(s) → +${gained} planta(s) gracias a los insectos vivos.`,
        "good"
      );
    } else {
      addLog(next, "🌱 No se intercambian nutrientes por plantas en esta ronda.", "info");
    }

    if (next.variant === "balanced" && next.board.plants > 0 && next.board.insects > 0) {
      const bonus = takeFromReserve(next, "plants", 2);
      if (bonus > 0) {
        addLog(next, `☀️ Polinización y sol (variante equilibrada): brotan +${bonus} plantas adicionales.`, "good");
      }
    }

    next.phase = "growth_repro";
    return next;
  }

  function runGrowthRepro(state) {
    const next = cloneState(state);
    const fedRabbits = next.roundMeta.fedRabbits;
    const fedLynx = next.roundMeta.fedLynx;

    // Conejos: +1 por cada 2 conejos bien alimentados
    const wantRabbits = Math.floor(fedRabbits / 2);
    const bornRabbits = takeFromReserve(next, "rabbits", wantRabbits);

    // Linces: +1 por cada 2 linces y 4 conejos bien alimentados
    const wantLynx = Math.min(Math.floor(fedLynx / 2), Math.floor(fedRabbits / 4));
    const bornLynx = takeFromReserve(next, "lynx", wantLynx);

    // Insectos: +1 por cada 8 plantas y 1 insecto (máximo 5 en el tablero, y bloqueado si insecticida activo)
    let bornInsects = 0;
    if (next.noInsectsRoundsLeft === 0 && next.board.insects >= 1) {
      const wantInsects = Math.floor(next.board.plants / 8);
      const roomToMax5 = Math.max(0, 5 - next.board.insects);
      bornInsects = takeFromReserve(next, "insects", Math.min(wantInsects, roomToMax5));
    }

    const parts = [];
    if (bornRabbits > 0) parts.push(`+${bornRabbits} conejo(s)`);
    if (bornLynx > 0) parts.push(`+${bornLynx} lince(s)`);
    if (bornInsects > 0) parts.push(`+${bornInsects} insecto(s)`);

    if (parts.length > 0) {
      addLog(next, `🐣 Nacimientos de la ronda: ${parts.join(", ")}.`, "good");
    } else {
      addLog(next, "🐣 No se cumplen condiciones para nuevos nacimientos en esta ronda.", "info");
    }

    // Guardar fila en Tabla de Registro
    next.history.push({
      round: next.round,
      label: `Ronda ${next.round}`,
      ...next.board,
      card: next.activeCard && next.activeCard.drawnRound === next.round ? next.activeCard.title : null,
    });

    next.phase = "round_end";
    return next;
  }

  function advanceRound(state) {
    const next = cloneState(state);
    if (next.round >= next.maxRounds) {
      next.status = "finished";
      return next;
    }

    next.round += 1;
    if (next.noInsectsRoundsLeft > 0) {
      next.noInsectsRoundsLeft -= 1;
    }
    next.predictions = {};

    // En la ronda 3, según el documento, cada equipo roba una carta del ecosistema
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
    const collapsed = b.plants === 0 || b.rabbits === 0 || b.insects === 0 || b.lynx === 0;

    if (b.insects === 0) {
      insights.push(
        "Sin insectos descomponedores ni polinizadores, los restos orgánicos se acumulan (" +
          b.remains +
          " en el centro) y no se transforman en nutrientes para nuevas plantas."
      );
    }
    if (b.plants === 0) {
      insights.push(
        "Al agotarse las plantas (productores), toda la red trófica se queda sin energía de base: los conejos y los insectos no pueden sobrevivir."
      );
    }
    if (b.lynx === 0 && b.rabbits > 0) {
      insights.push(
        "Sin linces ibéricos, no hay control natural sobre los herbívoros: aunque parezca bueno para los conejos, terminan sobreexplotando las plantas."
      );
    }
    if (b.lynx === 0 && b.rabbits === 0) {
      insights.push(
        "Tanto los conejos como el lince desaparecieron por efecto cascada al faltar alimento en el eslabón anterior."
      );
    }
    if (!collapsed) {
      insights.push(
        "¡Vuestro ecosistema ha mantenido representación en todos los eslabones hasta el final! Aun así, podéis ver en la gráfica cómo suben y bajan las poblaciones en equilibrio dinámico."
      );
    }
    if (state.activeCard) {
      insights.push(
        `La carta "${state.activeCard.title}" (${state.activeCard.effectText}) demostró que alterar una sola pieza afecta a todo el sistema.`
      );
    }
    return { collapsed, insights };
  }

  EcoGame.engine = {
    createInitialState,
    cloneState,
    startGame,
    getActivePhaseRole,
    submitPrediction,
    finishPredict,
    drawEcosystemCard,
    applyPendingCard,
    runFeedRabbits,
    runFeedLynx,
    runFeedInsects,
    runRecycle,
    getMaxExchange,
    runGrowthExchange,
    runGrowthRepro,
    advanceRound,
    triggerExtraCardRound,
    finishGameEarly,
    analyzeEcosystem,
  };
})(window);
