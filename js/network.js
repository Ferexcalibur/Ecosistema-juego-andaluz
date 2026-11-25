(function (global) {
  const EcoGame = (global.EcoGame = global.EcoGame || {});

  const PEER_PREFIX = "eco-andaluz-sala-";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const ICE_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
    ],
  };

  function generateCode(len = 6) {
    let out = "";
    for (let i = 0; i < len; i++) {
      out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return out;
  }

  class RoomManager {
    constructor() {
      this.mode = "none"; // 'none' | 'local' | 'host' | 'client'
      this.peer = null;
      this.hostConn = null;
      this.clients = new Map(); // peerId -> DataConnection
      this.myId = "local-player";
      this.myName = "Jugador";
      this.roomCode = null;
      this.state = null;
      this.botTimer = null;
      this.handlers = {
        onState: () => {},
        onStatus: () => {},
        onError: () => {},
        onMoveError: () => {},
        onFloater: () => {},
        onClosed: () => {},
      };
    }

    setHandlers(handlers) {
      this.handlers = { ...this.handlers, ...handlers };
    }

    isHostOrLocal() {
      return this.mode === "local" || this.mode === "host";
    }

    getMyPlayer() {
      if (!this.state) return null;
      return this.state.players.find((p) => p.id === this.myId) || null;
    }

    startLocal(name, config) {
      this.cleanup();
      this.mode = "local";
      this.myId = "local-host";
      this.myName = name;
      this.roomCode = null;
      const chosenRole = config.localRole === "all" ? null : config.localRole;
      const controlAll = config.localRole === "all";
      this.state = EcoGame.engine.createInitialState({
        ...config,
        controlAll,
        roomCode: null,
        players: [{ id: this.myId, name, role: chosenRole, isHost: true, isBot: false }],
      });
      this.state = EcoGame.engine.startGame(this.state);
      this.broadcastState();
    }

    createRoom(name, config, retries = 4) {
      this.cleanup();
      if (typeof global.Peer === "undefined") {
        this.handlers.onError(
          "No se pudo cargar el módulo multijugador (PeerJS). Comprueba tu conexión a internet o juega en Modo Local."
        );
        return;
      }

      this.mode = "host";
      this.myName = name;
      const code = generateCode(6);
      this.roomCode = code;
      const peerId = PEER_PREFIX + code;

      this.handlers.onStatus("Conectando sala...", "warning");
      const peer = new global.Peer(peerId, { config: ICE_CONFIG });
      this.peer = peer;

      peer.on("open", (id) => {
        this.myId = id;
        this.state = EcoGame.engine.createInitialState({
          ...config,
          controlAll: false,
          roomCode: code,
          players: [{ id, name, role: "lynx", isHost: true, isBot: false }],
        });
        this.state.chat.push({
          system: true,
          text: `${name} ha creado la sala ${code}.`,
        });
        this.handlers.onStatus("Sala conectada y lista para recibir jugadores", "ok");
        this.broadcastState();
      });

      peer.on("connection", (conn) => {
        this.attachClientConnection(conn);
      });

      peer.on("disconnected", () => {
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });

      peer.on("error", (err) => {
        if (err.type === "unavailable-id" && retries > 0) {
          this.createRoom(name, config, retries - 1);
          return;
        }
        this.handlers.onError("Error al crear la sala: " + (err.message || err.type));
      });
    }

    attachClientConnection(conn) {
      conn.on("open", () => {
        this.clients.set(conn.peer, conn);
        if (this.state) {
          conn.send({ type: "STATE_SYNC", state: this.state });
        }
      });

      conn.on("data", (msg) => {
        this.handleClientMessage(conn.peer, msg);
      });

      conn.on("close", () => {
        this.clients.delete(conn.peer);
        if (this.state) {
          const leaving = this.state.players.find((p) => p.id === conn.peer);
          this.state.players = this.state.players.filter((p) => p.id !== conn.peer);
          if (leaving) {
            if (this.state.status === "playing" && leaving.role) {
              const roleObj = EcoGame.ROLES.find((r) => r.id === leaving.role);
              this.state.players.push({
                id: `bot-${leaving.role}`,
                name: `Bot ${roleObj ? roleObj.name.split(" ")[0] : leaving.role}`,
                role: leaving.role,
                isHost: false,
                isBot: true,
              });
              this.state.chat.push({
                system: true,
                text: `${leaving.name} salió. Un Bot ha tomado el control de ${roleObj ? roleObj.name : leaving.role}.`,
              });
            } else {
              this.state.chat.push({
                system: true,
                text: `${leaving.name} ha salido de la sala.`,
              });
            }
          }
          this.broadcastState();
        }
      });
    }

    joinRoom(name, rawCode) {
      this.cleanup();
      if (typeof global.Peer === "undefined") {
        this.handlers.onError(
          "No se pudo cargar el módulo multijugador (PeerJS). Comprueba tu conexión a internet."
        );
        return;
      }

      const code = String(rawCode || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

      if (code.length < 4) {
        this.handlers.onError("Introduce un código de sala válido.");
        return;
      }

      this.mode = "client";
      this.myName = name;
      this.roomCode = code;
      this.handlers.onStatus(`Buscando sala ${code}...`, "warning");

      const peer = new global.Peer(undefined, { config: ICE_CONFIG });
      this.peer = peer;

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          this.cleanup();
          this.handlers.onError(
            `No se pudo conectar con la sala "${code}". Revisa que el código sea correcto y el anfitrión siga dentro.`
          );
        }
      }, 12000);

      peer.on("open", (id) => {
        this.myId = id;
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
        this.hostConn = conn;

        conn.on("open", () => {
          settled = true;
          clearTimeout(timer);
          conn.send({ type: "JOIN", name });
          this.handlers.onStatus(`Conectado a la sala ${code}`, "ok");
        });

        conn.on("data", (msg) => {
          if (msg.type === "STATE_SYNC") {
            this.state = msg.state;
            this.handlers.onState(this.state);
          } else if (msg.type === "MOVE_ERROR") {
            this.handlers.onMoveError(msg.error, msg.targetZone);
          } else if (msg.type === "MOVE_FLOATER") {
            this.handlers.onFloater(msg.text);
          } else if (msg.type === "HOST_CLOSED") {
            this.cleanup();
            this.handlers.onClosed("El anfitrión ha cerrado la sala.");
          }
        });

        conn.on("close", () => {
          if (settled) {
            this.cleanup();
            this.handlers.onClosed("Se perdió la conexión con el anfitrión de la sala.");
          }
        });

        conn.on("error", () => {
          clearTimeout(timer);
          if (!settled) {
            this.cleanup();
            this.handlers.onError(`No se encontró la sala "${code}".`);
          }
        });
      });

      peer.on("error", (err) => {
        clearTimeout(timer);
        this.cleanup();
        const friendly =
          err.type === "peer-unavailable"
            ? `La sala "${code}" no existe o ya se cerró.`
            : "Error de conexión: " + (err.message || err.type);
        this.handlers.onError(friendly);
      });
    }

    handleClientMessage(senderId, msg) {
      if (!this.state || !this.isHostOrLocal()) return;

      if (msg.type === "JOIN") {
        const cleanName = String(msg.name || "Jugador").slice(0, 20);
        const existing = this.state.players.find((p) => p.id === senderId);
        if (!existing) {
          // Asignar automáticamente el primer rol disponible si queda alguno libre
          const freeRole = EcoGame.engine.ROLE_ORDER.find(
            (r) => !this.state.players.some((p) => !p.isBot && p.role === r)
          );
          this.state.players.push({
            id: senderId,
            name: cleanName,
            role: freeRole || null,
            isHost: false,
            isBot: false,
          });
          this.state.chat.push({
            system: true,
            text: `${cleanName} se ha unido a la sala.`,
          });
        }
        this.broadcastState();
        return;
      }

      if (msg.type === "SELECT_ROLE") {
        const player = this.state.players.find((p) => p.id === senderId && !p.isBot);
        if (!player) return;
        const desired = msg.role || null;
        if (desired) {
          const takenByOther = this.state.players.find(
            (p) => !p.isBot && p.id !== senderId && p.role === desired
          );
          if (takenByOther) {
            this.sendMoveErrorTo(senderId, `Ese rol ya lo tiene ${takenByOther.name}.`, null);
            return;
          }
        }
        player.role = desired;
        this.broadcastState();
        return;
      }

      if (msg.type === "CHAT") {
        const player = this.state.players.find((p) => p.id === senderId);
        const text = String(msg.text || "").trim().slice(0, 180);
        if (player && text) {
          this.state.chat.push({
            author: player.name,
            text,
            system: false,
          });
          if (this.state.chat.length > 60) this.state.chat.shift();
          this.broadcastState();
        }
        return;
      }

      if (msg.type === "PREDICTION") {
        const player = this.state.players.find((p) => p.id === senderId);
        if (player) {
          this.state = EcoGame.engine.submitPrediction(
            this.state,
            senderId,
            player.name,
            msg.choice
          );
          this.broadcastState();
        }
        return;
      }

      if (msg.type === "GAME_ACTION") {
        this.applyActionAsHost(senderId, msg.action, msg.payload || {});
      }
    }

    sendMoveErrorTo(targetId, errorMsg, targetZone) {
      if (targetId === this.myId) {
        this.handlers.onMoveError(errorMsg, targetZone);
      } else {
        const conn = this.clients.get(targetId);
        if (conn && conn.open) {
          conn.send({ type: "MOVE_ERROR", error: errorMsg, targetZone });
        }
      }
    }

    dispatch(type, payload = {}) {
      if (this.isHostOrLocal()) {
        this.handleClientMessage(this.myId, { type, ...payload });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({ type, ...payload });
      }
    }

    dispatchGameAction(action, payload = {}) {
      if (this.isHostOrLocal()) {
        this.applyActionAsHost(this.myId, action, payload);
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({ type: "GAME_ACTION", action, payload });
      }
    }

    canPlayerAct(playerId, phase) {
      if (!this.state) return false;
      if (this.state.controlAll && playerId === this.myId) return true;
      const player = this.state.players.find((p) => p.id === playerId && !p.isBot);
      if (!player) return false;

      const neededRole = EcoGame.engine.getActivePhaseRole(phase);
      if (!neededRole) {
        // Fases generales (carta, predicción, fin de ronda): cualquier jugador humano en modo cooperativo/anfitrión
        if (phase === "card" || phase === "predict") return true;
        return player.isHost;
      }
      return player.role === neededRole;
    }

    applyActionAsHost(senderId, action, payload) {
      if (!this.state) return;
      const eng = EcoGame.engine;

      if (action === "START_GAME") {
        if (senderId !== this.myId) return;
        this.state = eng.startGame(this.state);
        this.broadcastState();
        return;
      }

      if (!this.canPlayerAct(senderId, this.state.phase)) {
        const owner = eng.getTurnOwner(this.state);
        if (owner) {
          this.sendMoveErrorTo(
            senderId,
            `⏳ Ahora es el turno de ${owner.name} (${owner.role}). Solo cada encargado mueve sus fichas.`,
            null
          );
        }
        return;
      }

      switch (action) {
        case "DRAW_CARD":
          if (this.state.phase === "card" && !this.state.pendingCard) {
            this.state = eng.drawEcosystemCard(this.state);
          }
          break;
        case "CONFIRM_CARD":
          if (this.state.phase === "card" && this.state.pendingCard) {
            this.state = eng.applyPendingCard(this.state);
          }
          break;
        case "FINISH_PREDICT":
          if (this.state.phase === "predict") {
            this.state = eng.finishPredict(this.state);
          }
          break;
        case "PERFORM_MOVE": {
          const res = eng.performMove(
            this.state,
            payload.targetZone,
            payload.mode || "one",
            payload.sourceZone || null,
            typeof payload.tokenIndex === "number" ? payload.tokenIndex : null
          );
          if (res.error) {
            this.sendMoveErrorTo(senderId, res.error, payload.targetZone);
            return;
          }
          this.state = res.state;
          if (res.floater) {
            if (senderId === this.myId) {
              this.handlers.onFloater(res.floater);
            } else {
              const c = this.clients.get(senderId);
              if (c && c.open) c.send({ type: "MOVE_FLOATER", text: res.floater });
            }
          }
          break;
        }
        case "PASS_TURN":
          this.state = eng.advanceTurnWithPass(this.state);
          break;
        case "NEXT_ROUND":
          if (this.state.phase === "round_end") {
            this.state = eng.advanceRound(this.state);
          }
          break;
        case "EXTRA_CARD":
          if (this.state.phase === "round_end") {
            this.state = eng.triggerExtraCardRound(this.state);
          }
          break;
        case "FINISH_GAME":
          this.state = eng.finishGameEarly(this.state);
          break;
        case "RESET_GAME":
          if (senderId === this.myId) {
            const humanPlayers = this.state.players.filter((p) => !p.isBot);
            const fresh = eng.createInitialState({
              ecosystem: this.state.ecosystem,
              variant: this.state.variant,
              controlAll: this.state.controlAll,
              maxRounds: this.state.maxRounds,
              roomCode: this.state.roomCode,
              players: humanPlayers,
            });
            fresh.chat = this.state.chat;
            this.state = eng.startGame(fresh);
          }
          break;
        default:
          break;
      }
      this.broadcastState();
    }

    scheduleBotIfNeeded() {
      if (this.botTimer) {
        clearTimeout(this.botTimer);
        this.botTimer = null;
      }
      if (!this.isHostOrLocal() || !this.state || this.state.status !== "playing") return;

      const owner = EcoGame.engine.getTurnOwner(this.state);
      if (!owner || !owner.isBot) return;

      const snapshotRound = this.state.round;
      const snapshotPhase = this.state.phase;

      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (!this.state || this.state.status !== "playing") return;
        if (this.state.round !== snapshotRound || this.state.phase !== snapshotPhase) return;

        const targetMap = {
          turn_rabbits: "plants",
          turn_lynx: "rabbits",
          turn_remains: "remains",
          turn_insects: "remains",
          turn_nutrients: "plants",
          turn_plants: "plants",
        };
        const targetZone = targetMap[this.state.phase];
        if (!targetZone) return;

        const res = EcoGame.engine.performMove(this.state, targetZone, "all");
        if (res && res.state) {
          this.state = res.state;
          EcoGame.sound.playPop();
          this.broadcastState();
        }
      }, 950);
    }

    broadcastState() {
      this.handlers.onState(this.state);
      if (this.mode === "host") {
        this.clients.forEach((conn) => {
          if (conn.open) {
            conn.send({ type: "STATE_SYNC", state: this.state });
          }
        });
      }
      this.scheduleBotIfNeeded();
    }

    cleanup() {
      if (this.botTimer) {
        clearTimeout(this.botTimer);
        this.botTimer = null;
      }
      if (this.mode === "host") {
        this.clients.forEach((conn) => {
          try {
            if (conn.open) conn.send({ type: "HOST_CLOSED" });
            conn.close();
          } catch (_) {}
        });
      }
      this.clients.clear();
      if (this.hostConn) {
        try {
          this.hostConn.close();
        } catch (_) {}
      }
      this.hostConn = null;
      if (this.peer) {
        try {
          this.peer.destroy();
        } catch (_) {}
      }
      this.peer = null;
      this.mode = "none";
      this.roomCode = null;
      this.state = null;
    }
  }

  EcoGame.room = new RoomManager();
})(window);
