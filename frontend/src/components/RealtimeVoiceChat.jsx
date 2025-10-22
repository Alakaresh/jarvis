import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;

const normaliseEnvValue = (value) => (typeof value === "string" ? value.trim() : "");

const computeDefaultSessionUrl = () => {
  const explicit = normaliseEnvValue(env?.VITE_REALTIME_SESSION_URL);
  if (explicit) {
    return explicit;
  }

  const backendBase = normaliseEnvValue(env?.VITE_BACKEND_URL);

  if (backendBase) {
    try {
      return new URL("/api/realtime/session", backendBase).toString();
    } catch (error) {
      console.warn(
        "Impossible de construire l'URL de session temps réel depuis VITE_BACKEND_URL",
        error
      );
    }
  }

  return "http://127.0.0.1:8000/api/realtime/session";
};

const SESSION_ENDPOINT = computeDefaultSessionUrl();
const DEFAULT_VOICE =
  normaliseEnvValue(env?.VITE_REALTIME_VOICE) ||
  normaliseEnvValue(env?.VITE_OPENAI_REALTIME_VOICE) ||
  "";
const DEFAULT_LANGUAGE =
  normaliseEnvValue(env?.VITE_REALTIME_LANGUAGE) ||
  normaliseEnvValue(env?.VITE_OPENAI_REALTIME_LANGUAGE) ||
  "";

const STATUS_METADATA = {
  idle: { label: "Prêt à démarrer", tone: "idle" },
  "requesting-permission": {
    label: "Autorisation du micro…",
    tone: "pending",
  },
  connecting: { label: "Connexion à Jarvis…", tone: "pending" },
  "awaiting-answer": { label: "Jarvis prépare une réponse…", tone: "thinking" },
  listening: { label: "Jarvis écoute", tone: "listening" },
  speaking: { label: "Jarvis parle", tone: "speaking" },
  error: { label: "Erreur détectée", tone: "error" },
};

const ACTIVE_STATES = new Set([
  "requesting-permission",
  "connecting",
  "awaiting-answer",
  "listening",
  "speaking",
]);

const waitForIceGatheringComplete = (pc, timeoutMs = 2000) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }

    let timeoutId;

    const checkState = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", checkState);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        resolve();
      }
    };

    pc.addEventListener("icegatheringstatechange", checkState);

    timeoutId = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", checkState);
      resolve();
    }, timeoutMs);
  });

function RealtimeVoiceChat() {
  const [sessionState, setSessionState] = useState("idle");
  const [errorMessage, setErrorMessage] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE);
  const [selectedLanguage, setSelectedLanguage] = useState(DEFAULT_LANGUAGE);
  const [hasSupport, setHasSupport] = useState(false);
  const [supportChecked, setSupportChecked] = useState(false);

  const pcRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const mountedRef = useRef(true);
  const sessionAttemptRef = useRef(0);

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      typeof window.RTCPeerConnection === "function" &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia);

    setHasSupport(supported);
    setSupportChecked(true);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cleanupMedia = useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    }

    pcRef.current = null;

    const localStream = microphoneStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn("Impossible d'arrêter une piste locale", error);
        }
      });
    }

    microphoneStreamRef.current = null;

    const audioElement = remoteAudioRef.current;
    if (audioElement) {
      audioElement.srcObject = null;
    }
  }, []);

  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  const stopSession = useCallback(() => {
    sessionAttemptRef.current += 1;
    cleanupMedia();
    if (!mountedRef.current) {
      return;
    }

    setSessionState("idle");
    setErrorMessage(null);
  }, [cleanupMedia]);

  const buildSessionUrl = useCallback(() => {
    let endpoint = SESSION_ENDPOINT;
    if (!endpoint) {
      endpoint = "http://127.0.0.1:8000/api/realtime/session";
    }

    let url;
    try {
      if (/^https?:/i.test(endpoint)) {
        url = new URL(endpoint);
      } else {
        const origin =
          typeof window !== "undefined" && window.location?.origin
            ? window.location.origin
            : "http://127.0.0.1:3000";
        url = new URL(endpoint, origin);
      }
    } catch (error) {
      console.warn("URL de session invalide, utilisation du fallback local", error);
      url = new URL("http://127.0.0.1:8000/api/realtime/session");
    }

    const voice = selectedVoice.trim();
    if (voice) {
      url.searchParams.set("voice", voice);
    } else {
      url.searchParams.delete("voice");
    }

    const language = selectedLanguage.trim();
    if (language) {
      url.searchParams.set("language", language);
    } else {
      url.searchParams.delete("language");
    }

    return url.toString();
  }, [selectedLanguage, selectedVoice]);

  const startSession = useCallback(async () => {
    if (!supportChecked) {
      return;
    }

    if (!hasSupport) {
      setErrorMessage(
        "WebRTC n'est pas disponible sur ce navigateur. Utilise Chrome, Edge ou Opera."
      );
      setSessionState("error");
      return;
    }

    if (ACTIVE_STATES.has(sessionState)) {
      return;
    }

    sessionAttemptRef.current += 1;
    const attemptId = sessionAttemptRef.current;

    setErrorMessage(null);
    setSessionState("requesting-permission");

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      if (!mountedRef.current || sessionAttemptRef.current !== attemptId) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      if (!mountedRef.current || sessionAttemptRef.current !== attemptId) {
        mediaStream.getTracks().forEach((track) => track.stop());
        peerConnection.close();
        return;
      }

      microphoneStreamRef.current = mediaStream;
      pcRef.current = peerConnection;
      setSessionState("connecting");

      mediaStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream);
      });

      peerConnection.ontrack = (event) => {
        if (!mountedRef.current || pcRef.current !== peerConnection) {
          return;
        }

        setSessionState("speaking");

        const [remoteStream] = event.streams;
        const audioElement = remoteAudioRef.current;

        if (remoteStream && audioElement) {
          audioElement.srcObject = remoteStream;
          const playPromise = audioElement.play();
          if (playPromise?.catch) {
            playPromise.catch((error) => {
              console.warn("Lecture audio impossible sans interaction utilisateur", error);
            });
          }
        }

        event.track.addEventListener("ended", () => {
          if (!mountedRef.current || pcRef.current !== peerConnection) {
            return;
          }

          setSessionState((current) =>
            current === "speaking" ? "listening" : current
          );
        });
      };

      peerConnection.onconnectionstatechange = () => {
        if (!mountedRef.current || pcRef.current !== peerConnection) {
          return;
        }

        const { connectionState } = peerConnection;

        if (connectionState === "connected") {
          setSessionState((current) =>
            current === "speaking" ? "speaking" : "listening"
          );
        } else if (connectionState === "failed") {
          cleanupMedia();
          if (!mountedRef.current) {
            return;
          }
          setSessionState("error");
          setErrorMessage("La connexion WebRTC a échoué.");
        } else if (connectionState === "disconnected") {
          cleanupMedia();
          if (!mountedRef.current) {
            return;
          }
          setSessionState("error");
          setErrorMessage("La connexion WebRTC a été interrompue.");
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        if (!mountedRef.current || pcRef.current !== peerConnection) {
          return;
        }

        if (peerConnection.iceConnectionState === "failed") {
          cleanupMedia();
          if (!mountedRef.current) {
            return;
          }
          setSessionState("error");
          setErrorMessage("La négociation ICE a échoué.");
        }
      };

      peerConnection.addEventListener("icecandidateerror", (event) => {
        console.warn("Erreur ICE", event);
      });

      const offer = await peerConnection.createOffer();

      if (!mountedRef.current || sessionAttemptRef.current !== attemptId) {
        peerConnection.close();
        return;
      }

      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      if (!mountedRef.current || sessionAttemptRef.current !== attemptId) {
        peerConnection.close();
        return;
      }

      const localDescription = peerConnection.localDescription;

      if (!localDescription?.sdp) {
        throw new Error("Impossible de récupérer l'offre SDP locale.");
      }

      setSessionState("awaiting-answer");

      const response = await fetch(buildSessionUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: localDescription.sdp,
      });

      if (!mountedRef.current || sessionAttemptRef.current !== attemptId) {
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Erreur du proxy temps réel (${response.status}) : ${
            errorText || "réponse vide"
          }`
        );
      }

      const answer = await response.text();

      if (!mountedRef.current || sessionAttemptRef.current !== attemptId) {
        return;
      }

      await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
      if (mountedRef.current && sessionAttemptRef.current === attemptId) {
        setSessionState("listening");
      }
    } catch (error) {
      const shouldIgnore =
        !mountedRef.current || sessionAttemptRef.current !== attemptId;

      if (!shouldIgnore) {
        cleanupMedia();
      }

      if (shouldIgnore) {
        return;
      }

      console.error("Impossible d'initialiser la session vocale temps réel", error);

      let message = "Impossible d'initialiser la conversation vocale.";

      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        message = "Accès au micro refusé. Merci d'autoriser l'utilisation du micro.";
      } else if (error?.name === "NotFoundError") {
        message = "Aucun micro détecté sur cet appareil.";
      } else if (typeof error?.message === "string") {
        if (error.message.includes("Failed to fetch")) {
          message = "La connexion au proxy temps réel a échoué.";
        } else {
          message = error.message;
        }
      }

      setErrorMessage(message);
      setSessionState("error");
    }
  }, [buildSessionUrl, cleanupMedia, hasSupport, sessionState, supportChecked]);

  const voiceOptions = useMemo(() => {
    const options = [
      { value: "", label: "Voix par défaut (OpenAI)" },
      { value: "alloy", label: "Alloy" },
      { value: "verse", label: "Verse" },
    ];

    if (DEFAULT_VOICE && !options.some((option) => option.value === DEFAULT_VOICE)) {
      options.splice(1, 0, { value: DEFAULT_VOICE, label: DEFAULT_VOICE });
    }

    return options;
  }, []);

  const statusDescriptor = STATUS_METADATA[sessionState] || STATUS_METADATA.idle;
  const isSessionActive = ACTIVE_STATES.has(sessionState);

  return (
    <section className="realtime-voice-card">
      <header className="realtime-voice-header">
        <div className="realtime-voice-titles">
          <h2 className="realtime-voice-title">🎙️ Conversation vocale temps réel</h2>
          <p className="realtime-voice-description">
            Discute avec Jarvis à la voix : ton micro est envoyé en toute sécurité au
            backend qui négocie directement avec OpenAI.
          </p>
        </div>
        <span
          className="realtime-voice-status"
          data-tone={statusDescriptor.tone}
          role="status"
        >
          <span className="realtime-voice-status-indicator" aria-hidden="true" />
          {statusDescriptor.label}
        </span>
      </header>

      <div className="realtime-voice-controls">
        <div className="realtime-voice-actions">
          <button
            type="button"
            className={`realtime-voice-button start${isSessionActive ? " disabled" : ""}`}
            onClick={startSession}
            disabled={!supportChecked || !hasSupport || isSessionActive}
            aria-disabled={!supportChecked || !hasSupport || isSessionActive}
          >
            🎤 Démarrer
          </button>
          <button
            type="button"
            className={`realtime-voice-button stop${isSessionActive ? "" : " disabled"}`}
            onClick={stopSession}
            disabled={!isSessionActive}
            aria-disabled={!isSessionActive}
          >
            🔇 Stop
          </button>
        </div>

        <label className="realtime-voice-select">
          <span className="realtime-voice-select-label">Voix</span>
          <select
            value={selectedVoice}
            onChange={(event) => setSelectedVoice(event.target.value)}
            disabled={isSessionActive}
          >
            {voiceOptions.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="realtime-voice-language">
          <span className="realtime-voice-select-label">Langue (optionnel)</span>
          <input
            type="text"
            value={selectedLanguage}
            onChange={(event) => setSelectedLanguage(event.target.value)}
            placeholder="ex: fr-FR"
            disabled={isSessionActive}
          />
        </label>
      </div>

      {!supportChecked && (
        <p className="realtime-voice-note">Vérification du support navigateur…</p>
      )}

      {supportChecked && !hasSupport && (
        <p className="realtime-voice-note" role="alert">
          Ce navigateur ne prend pas en charge WebRTC. Essaie avec Chrome, Edge ou Opera GX.
        </p>
      )}

      {errorMessage && (
        <p className="realtime-voice-error" role="alert">
          {errorMessage}
        </p>
      )}

      <audio
        ref={remoteAudioRef}
        className="realtime-voice-audio"
        autoPlay
        playsInline
        aria-hidden="true"
      />
    </section>
  );
}

export default RealtimeVoiceChat;
