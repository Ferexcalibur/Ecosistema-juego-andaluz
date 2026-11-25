(function (global) {
  const EcoGame = (global.EcoGame = global.EcoGame || {});
  const $ = (id) => document.getElementById(id);

  function copyText(text, label) {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => EcoGame.ui.showToast(`${label} copiado: ${text}`))
      .catch(() => EcoGame.ui.showToast(`Copia manualmente: ${text}`));
  }

  function buildShareLink(code) {
    const url = new URL(global.location.href);
    url.searchParams.set("sala", code);
    return url.toString();
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Rellenar modal de reglas
    $("rules-modal-body").innerHTML = EcoGame.RULES_HTML;

    // Detectar parámetro ?sala=CODIGO en URL (útil en GitHub Pages)
    const params = new URLSearchParams(global.location.search);
    const urlCode = params.get("sala");
    if (urlCode) {
      $("join-code").value = urlCode.toUpperCase();
      $("join-name").focus();
      EcoGame.ui.showToast(`Código de sala ${urlCode.toUpperCase()} detectado en el enlace`);
    }

    // Configurar callbacks de red
    EcoGame.room.setHandlers({
      onState: (state) => {
        if (!state) return;
        EcoGame.ui.clearJoinStatus();
        if (state.status === "lobby") {
          EcoGame.ui.renderLobby(state);
        } else if (state.status === "playing") {
          EcoGame.ui.renderGame(state);
        } else if (state.status === "finished") {
          EcoGame.ui.renderSummary(state);
        }
      },
      onStatus: (msg, level) => {
        EcoGame.ui.setLobbyConnStatus(msg, level);
        if ($("screen-home").classList.contains("active")) {
          EcoGame.ui.setJoinStatus(msg, false);
        }
      },
      onError: (errMsg) => {
        EcoGame.ui.setJoinStatus(errMsg, true);
        EcoGame.ui.showToast(errMsg);
      },
      onMoveError: (errMsg, targetZone) => {
        EcoGame.sound.playWarn();
        EcoGame.ui.shakeZone(targetZone);
        EcoGame.ui.showToast(errMsg);
      },
      onClosed: (reason) => {
        EcoGame.ui.showToast(reason);
        $("topbar-room-pill").classList.add("hidden");
        EcoGame.ui.showScreen("screen-home");
      },
    });

    // Crear sala
    $("form-create-room").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("create-name").value.trim() || "Anfitrión";
      EcoGame.room.createRoom(name, {
        ecosystem: $("create-ecosystem").value,
        variant: $("create-variant").value,
      });
    });

    // Unirse a sala
    $("form-join-room").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("join-name").value.trim() || "Explorador";
      const code = $("join-code").value.trim();
      EcoGame.room.joinRoom(name, code);
    });

    // Modo local
    $("form-local-game").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("local-name").value.trim() || "Equipo";
      EcoGame.room.startLocal(name, {
        ecosystem: $("local-ecosystem").value,
        variant: $("local-variant").value,
        localRole: $("local-role").value,
      });
    });

    // Copiar código y enlace
    $("btn-copy-code").addEventListener("click", () => {
      copyText(EcoGame.room.roomCode, "Código de sala");
    });
    $("btn-copy-code-top").addEventListener("click", () => {
      copyText(EcoGame.room.roomCode, "Código de sala");
    });
    $("btn-copy-link").addEventListener("click", () => {
      if (EcoGame.room.roomCode) {
        copyText(buildShareLink(EcoGame.room.roomCode), "Enlace de invitación");
      }
    });

    // Iniciar partida desde lobby
    $("btn-start-game").addEventListener("click", () => {
      EcoGame.sound.playGood();
      EcoGame.room.dispatchGameAction("START_GAME");
    });

    // Confirmar carta en modal
    $("btn-confirm-card").addEventListener("click", () => {
      EcoGame.sound.playPop();
      EcoGame.room.dispatchGameAction("CONFIRM_CARD");
    });

    // Chats
    $("form-lobby-chat").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("lobby-chat-input");
      if (input.value.trim()) {
        EcoGame.room.dispatch("CHAT", { text: input.value.trim() });
        input.value = "";
      }
    });

    $("form-game-chat").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("game-chat-input");
      if (input.value.trim()) {
        EcoGame.room.dispatch("CHAT", { text: input.value.trim() });
        input.value = "";
      }
    });

    document.querySelectorAll(".prompt-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const input = $("game-chat-input");
        input.value = chip.dataset.msg;
        input.focus();
      });
    });

    // Pestañas derecha
    document.querySelectorAll(".side-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".side-tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        $(`tab-${tab.dataset.tab}`).classList.add("active");
        if (tab.dataset.tab === "chat" && EcoGame.room.state) {
          EcoGame.ui.markChatRead(EcoGame.room.state.chat.length);
        }
      });
    });

    // Salir / Volver al inicio
    const leaveAll = () => {
      EcoGame.room.cleanup();
      $("topbar-room-pill").classList.add("hidden");
      EcoGame.ui.clearJoinStatus();
      EcoGame.ui.showScreen("screen-home");
    };

    $("btn-leave-lobby").addEventListener("click", leaveAll);
    $("btn-leave-game").addEventListener("click", leaveAll);
    $("btn-back-home").addEventListener("click", leaveAll);
    $("btn-home-logo").addEventListener("click", () => {
      if (EcoGame.room.mode === "none") return;
      if (confirm("¿Quieres salir de la partida actual y volver al inicio?")) {
        leaveAll();
      }
    });

    $("btn-finish-early").addEventListener("click", () => {
      EcoGame.room.dispatchGameAction("FINISH_GAME");
    });

    $("btn-play-again").addEventListener("click", () => {
      EcoGame.room.dispatchGameAction("RESET_GAME");
    });

    // Sonido
    $("btn-toggle-sound").addEventListener("click", () => {
      EcoGame.sound.muted = !EcoGame.sound.muted;
      $("btn-toggle-sound").textContent = EcoGame.sound.muted ? "🔇 Silencio" : "🔊 Sonido";
    });

    // Modal Reglas
    const closeRules = () => $("modal-rules").classList.add("hidden");
    $("btn-open-rules").addEventListener("click", () => $("modal-rules").classList.remove("hidden"));
    $("btn-close-rules").addEventListener("click", closeRules);
    $("modal-rules-backdrop").addEventListener("click", closeRules);
  });
})(window);
