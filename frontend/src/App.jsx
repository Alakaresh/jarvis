import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const LANGUAGE_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  ps: "powershell",
  pwsh: "powershell",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
};

const SHELL_LANGUAGES = new Set(["bash", "sh", "zsh", "powershell"]);
const C_STYLE_LANGUAGES = new Set([
  "javascript",
  "typescript",
  "java",
  "c",
  "cpp",
  "csharp",
  "go",
  "kotlin",
  "swift",
  "php",
  "rust",
]);

const STATUS_KEYWORDS = new Set([
  "listening",
  "established",
  "time_wait",
  "close_wait",
  "syn_sent",
  "syn_received",
  "fin_wait_1",
  "fin_wait_2",
]);

const PROCESS_KEYWORDS = new Set([
  "nginx",
  "uvicorn",
  "gunicorn",
  "node",
  "python",
  "java",
  "docker",
]);

const PROTOCOL_KEYWORDS = new Set([
  "http",
  "https",
  "tcp",
  "udp",
  "ws",
  "wss",
  "grpc",
]);

const CONSTANT_KEYWORDS = new Set([
  "true",
  "false",
  "none",
  "null",
  "undefined",
]);

const GENERAL_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "class",
  "def",
  "async",
  "await",
  "import",
  "from",
  "try",
  "catch",
  "finally",
  "raise",
  "except",
  "switch",
  "case",
  "break",
  "continue",
  "public",
  "private",
  "protected",
  "static",
  "new",
  "this",
  "super",
  "lambda",
  "print",
  "pass",
  "yield",
  "export",
  "extends",
  "implements",
  "pid",
  "netstat",
]);

const KEYWORD_PATTERN = Array.from(
  new Set([
    ...GENERAL_KEYWORDS,
    ...CONSTANT_KEYWORDS,
    ...STATUS_KEYWORDS,
    ...PROCESS_KEYWORDS,
    ...PROTOCOL_KEYWORDS,
  ])
)
  .sort()
  .join("|");

const regexParts = [
  String.raw`("(?:\\.|[^"\\])*")`,
  String.raw`('(?:\\.|[^'\\])*')`,
  String.raw`(\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d{1,5})?\\b)`,
  String.raw`(0x[\\da-fA-F]+\\b)`,
  String.raw`(0b[01_]+\\b)`,
  String.raw`(0o[0-7_]+\\b)`,
  String.raw`(\\b\\d+(?:\\.\\d+)?\\b)`,
  String.raw`(\\b(?:${KEYWORD_PATTERN})\\b)`,
  String.raw`([+\-*/%=&|^!<>?:]+)`,
  String.raw`([\\[\\]{}()])`,
  String.raw`([.,;])`,
];

const HIGHLIGHT_REGEX = new RegExp(regexParts.join("|"), "gi");

const HASH_COMMENT_LANGUAGES = new Set([
  "python",
  "ruby",
  "bash",
  "sh",
  "zsh",
  "powershell",
]);

const VOICE_MODE_BROWSER = "browser";
const VOICE_MODE_FALLBACK = "fallback";
const VOICE_MODE_UNSUPPORTED = "unsupported";

const REALTIME_MODEL = "gpt-4o-realtime-preview";
const REALTIME_VOICES = [
  { value: "verse", label: "Verse" },
  { value: "alloy", label: "Alloy" },
];

const WAKE_WORD = "jarvis";
const WAKE_WORD_PATTERN = /\bjarvis\b/i;
const HOTWORD_COOLDOWN_MS = 6000;
const HOTWORD_RESTART_DELAY_MS = 800;

const guessExtensionFromMime = (mimeType) => {
  if (typeof mimeType !== "string") {
    return "webm";
  }

  const lower = mimeType.toLowerCase();

  if (lower.includes("ogg")) {
    return "ogg";
  }

  if (lower.includes("mpeg")) {
    return "mp3";
  }

  if (lower.includes("mp4") || lower.includes("m4a")) {
    return "m4a";
  }

  if (lower.includes("wav")) {
    return "wav";
  }

  return "webm";
};

const normaliseLanguage = (language) => {
  if (!language) return undefined;
  const trimmed = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[trimmed] || trimmed;
};

const isShellLanguage = (language) => {
  if (!language) return false;
  return SHELL_LANGUAGES.has(language);
};

const isCStyleLanguage = (language) => {
  if (!language) return false;
  return C_STYLE_LANGUAGES.has(language);
};

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const highlightCommentLine = (line) =>
  `<span class="token-comment">${escapeHtml(line)}</span>`;

const findCommentStart = (line, canonicalLanguage) => {
  const checkHash = canonicalLanguage
    ? HASH_COMMENT_LANGUAGES.has(canonicalLanguage)
    : false;
  const checkSlashSlash = canonicalLanguage
    ? isCStyleLanguage(canonicalLanguage)
    : false;

  if (!checkHash && !checkSlashSlash) {
    return -1;
  }

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let escapeNext = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      if (inSingleQuote || inDoubleQuote || inBacktick) {
        escapeNext = true;
      }
      continue;
    }

    if (char === "'" && !inDoubleQuote && !inBacktick) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote && !inBacktick) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "`" && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (checkSlashSlash && char === "/" && line[index + 1] === "/") {
        return index;
      }

      if (checkHash && char === "#") {
        return index;
      }
    }
  }

  return -1;
};

const highlightTokensInternal = (line) => {
  if (!line) {
    return "";
  }

  let highlighted = "";
  let lastIndex = 0;

  HIGHLIGHT_REGEX.lastIndex = 0;
  let match;

  while ((match = HIGHLIGHT_REGEX.exec(line)) !== null) {
    const [
      fullMatch,
      doubleQuoted,
      singleQuoted,
      ipAddress,
      hexNumber,
      binaryNumber,
      octalNumber,
      numberLiteral,
      keyword,
      operatorToken,
      bracketToken,
      punctuationToken,
    ] = match;

    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      highlighted += escapeHtml(line.slice(lastIndex, matchIndex));
    }

    let tokenClass = null;
    let tokenContent =
      doubleQuoted ||
      singleQuoted ||
      ipAddress ||
      hexNumber ||
      binaryNumber ||
      octalNumber ||
      numberLiteral ||
      keyword ||
      operatorToken ||
      bracketToken ||
      punctuationToken ||
      fullMatch;

    if (doubleQuoted || singleQuoted) {
      tokenClass = "token-string";
    } else if (ipAddress) {
      tokenClass = "token-ip";
    } else if (hexNumber || binaryNumber || octalNumber || numberLiteral) {
      tokenClass = "token-number";
    } else if (keyword) {
      const lowerKeyword = keyword.toLowerCase();

      if (STATUS_KEYWORDS.has(lowerKeyword)) {
        tokenClass = "token-status";
      } else if (PROCESS_KEYWORDS.has(lowerKeyword)) {
        tokenClass = "token-process";
      } else if (PROTOCOL_KEYWORDS.has(lowerKeyword)) {
        tokenClass = "token-protocol";
      } else if (CONSTANT_KEYWORDS.has(lowerKeyword)) {
        tokenClass = "token-constant";
      } else {
        tokenClass = "token-keyword";
      }
    } else if (operatorToken) {
      tokenClass = "token-operator";
    } else if (bracketToken || punctuationToken) {
      tokenClass = "token-punctuation";
    }

    if (tokenClass) {
      highlighted += `<span class="${tokenClass}">${escapeHtml(
        tokenContent
      )}</span>`;
    } else {
      highlighted += escapeHtml(fullMatch);
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < line.length) {
    highlighted += escapeHtml(line.slice(lastIndex));
  }

  return highlighted;
};

const highlightTokens = (line, canonicalLanguage) => {
  if (!line) {
    return "";
  }

  const commentStart = findCommentStart(line, canonicalLanguage);

  if (commentStart !== -1) {
    const codePart = line.slice(0, commentStart);
    const commentPart = line.slice(commentStart);
    const highlightedCode =
      commentStart > 0 ? highlightTokensInternal(codePart) : "";

    return `${highlightedCode}${highlightCommentLine(commentPart)}`;
  }

  return highlightTokensInternal(line);
};

const highlightCode = (code, language) => {
  if (!code) {
    return "";
  }

  const canonicalLanguage = normaliseLanguage(language);
  const segments = code.split(/(\r?\n)/);

  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        return segment;
      }

      if (!segment) {
        return "";
      }

      const trimmed = segment.trim();

      if (trimmed.length === 0) {
        return escapeHtml(segment);
      }

      const startsWithHash = /^\s*#/.test(segment);
      const startsWithSlashSlash = /^\s*\//.test(segment.trim());

      if (startsWithHash && (isShellLanguage(canonicalLanguage) || !canonicalLanguage)) {
        return highlightCommentLine(segment);
      }

      if (startsWithSlashSlash && (isCStyleLanguage(canonicalLanguage) || !canonicalLanguage)) {
        return highlightCommentLine(segment);
      }

      return highlightTokens(segment, canonicalLanguage);
    })
    .join("");
};

const splitIntoParagraphs = (text) => {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.filter((paragraph) => paragraph.trim() !== "");
};

const joinWithSpace = (left, right) => {
  const safeLeft = typeof left === "string" ? left : "";
  const safeRight = typeof right === "string" ? right : "";

  if (!safeRight) {
    return safeLeft;
  }

  if (!safeLeft) {
    return safeRight;
  }

  if (/\s$/.test(safeLeft) || /^\s/.test(safeRight)) {
    return `${safeLeft}${safeRight}`;
  }

  return `${safeLeft} ${safeRight}`;
};

const createInlineElements = (text, keyBase) => {
  if (!text) {
    return [];
  }

  const inlineCodeRegex = /`([^`]+)`/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = inlineCodeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    parts.push({ type: "code", value: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ type: "text", value: text });
  }

  return parts.flatMap((part, index) => {
    if (part.type === "code") {
      return (
        <code key={`${keyBase}-code-${index}`} className="inline-code">
          {part.value}
        </code>
      );
    }

    const segments = part.value.split("\n");

    return segments.flatMap((segment, lineIndex) => {
      const elements = [
        <Fragment key={`${keyBase}-text-${index}-${lineIndex}`}>{segment}</Fragment>,
      ];

      if (lineIndex < segments.length - 1) {
        elements.push(
          <br key={`${keyBase}-br-${index}-${lineIndex}`} />
        );
      }

      return elements;
    });
  });
};

const renderRichText = (text, keyBase) => {
  const paragraphs = splitIntoParagraphs(text);

  if (paragraphs.length === 0) {
    return (
      <p key={`${keyBase}-paragraph-0`} className="message-text">
        {createInlineElements(text, `${keyBase}-paragraph-0`)}
      </p>
    );
  }

  return paragraphs.map((paragraph, paragraphIndex) => {
    const lines = paragraph.split("\n");
    const isBulletedList = lines.every((line) => /^\s*[-*+]\s+/.test(line));
    const isOrderedList = lines.every((line) => /^\s*\d+\.\s+/.test(line));

    if (isBulletedList || isOrderedList) {
      const listItems = lines.filter((line) => line.trim() !== "");

      return (
        <ul
          key={`${keyBase}-list-${paragraphIndex}`}
          className={`message-list ${isOrderedList ? "ordered" : "unordered"}`}
        >
          {listItems.map((item, itemIndex) => {
            const content = item.replace(isOrderedList ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, "");

            return (
              <li
                key={`${keyBase}-list-${paragraphIndex}-${itemIndex}`}
                className="message-list-item"
              >
                {createInlineElements(
                  content,
                  `${keyBase}-list-${paragraphIndex}-${itemIndex}`
                )}
              </li>
            );
          })}
        </ul>
      );
    }

    return (
      <p
        key={`${keyBase}-paragraph-${paragraphIndex}`}
        className="message-text"
      >
        {createInlineElements(
          paragraph,
          `${keyBase}-paragraph-${paragraphIndex}`
        )}
      </p>
    );
  });
};

function App() {
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState([
    { id: 1, title: "Conversation 1", messages: [] },
  ]);
  const [activeConversationId, setActiveConversationId] = useState(1);
  const [loadingConversationIds, setLoadingConversationIds] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedCodeKey, setCopiedCodeKey] = useState(null);
  const [isVoiceSupported, setIsVoiceSupported] = useState(false);
  const [hasCheckedVoiceSupport, setHasCheckedVoiceSupport] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState("idle");
  const [realtimeError, setRealtimeError] = useState("");
  const [realtimeVoice, setRealtimeVoice] = useState(REALTIME_VOICES[0].value);
  const [isWakeWordEnabled, setIsWakeWordEnabled] = useState(false);
  const [wakeWordError, setWakeWordError] = useState("");
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);
  const conversationCounterRef = useRef(1);
  const chatRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const copyTimeoutRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceCaptureStateRef = useRef({ base: "", final: "" });
  const voiceModeRef = useRef(VOICE_MODE_UNSUPPORTED);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fallbackMimeTypeRef = useRef("audio/webm");
  const peerConnectionRef = useRef(null);
  const realtimeStreamRef = useRef(null);
  const realtimeRemoteAudioRef = useRef(null);
  const hotwordRecognitionRef = useRef(null);
  const hotwordRestartTimeoutRef = useRef(null);
  const hotwordActivationTimeoutRef = useRef(null);
  const hotwordManualStopRef = useRef(false);
  const hotwordCooldownTimestampRef = useRef(0);
  const startVoiceRecognitionRef = useRef(null);
  const isListeningRef = useRef(isListening);
  const isTranscribingAudioRef = useRef(isTranscribingAudio);
  const isRealtimeActiveRef = useRef(isRealtimeActive);
  const isWakeWordEnabledRef = useRef(isWakeWordEnabled);

  const stopHotwordDetection = useCallback((markManualStop = true) => {
    if (hotwordRestartTimeoutRef.current) {
      clearTimeout(hotwordRestartTimeoutRef.current);
      hotwordRestartTimeoutRef.current = null;
    }

    if (hotwordActivationTimeoutRef.current) {
      clearTimeout(hotwordActivationTimeoutRef.current);
      hotwordActivationTimeoutRef.current = null;
    }

    hotwordManualStopRef.current = markManualStop;

    const recognition = hotwordRecognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;

      try {
        recognition.stop();
      } catch (error) {
        if (error?.name !== "InvalidStateError") {
          console.warn("Impossible d'arrêter la détection du mot clé", error);
        }
      }
    }

    hotwordRecognitionRef.current = null;
  }, []);

  const stopRealtimeSession = useCallback(() => {
    const peerConnection = peerConnectionRef.current;
    if (peerConnection) {
      try {
        peerConnection.ontrack = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
      } catch (error) {
        console.warn("Impossible de fermer la connexion WebRTC", error);
      }
    }
    peerConnectionRef.current = null;

    const localStream = realtimeStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn("Impossible d'arrêter une piste WebRTC", error);
        }
      });
    }
    realtimeStreamRef.current = null;

    const remoteAudioElement = realtimeRemoteAudioRef.current;
    if (remoteAudioElement) {
      try {
        remoteAudioElement.pause();
      } catch (error) {
        console.warn("Impossible de mettre l'audio distant en pause", error);
      }
      remoteAudioElement.srcObject = null;
      remoteAudioElement.onplaying = null;
      remoteAudioElement.onpause = null;
      remoteAudioElement.onended = null;
      remoteAudioElement.onwaiting = null;
    }

    setIsRealtimeActive(false);
    setRealtimeStatus("idle");
  }, []);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isTranscribingAudioRef.current = isTranscribingAudio;
  }, [isTranscribingAudio]);

  useEffect(() => {
    isRealtimeActiveRef.current = isRealtimeActive;
  }, [isRealtimeActive]);

  useEffect(() => {
    isWakeWordEnabledRef.current = isWakeWordEnabled;
  }, [isWakeWordEnabled]);

  const cleanupMediaStream = () => {
    const stream = mediaStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn("Impossible d'arrêter une piste audio", error);
        }
      });
    }

    mediaStreamRef.current = null;
  };

  const processRecordedAudio = async (chunks, mimeType) => {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      setVoiceError("Aucun son détecté. Réessaie.");
      return;
    }

    const safeMimeType = typeof mimeType === "string" && mimeType
      ? mimeType
      : fallbackMimeTypeRef.current;
    const blob = new Blob(chunks, { type: safeMimeType });
    const extension = guessExtensionFromMime(safeMimeType);
    const formData = new FormData();
    formData.append("audio", blob, `dictation.${extension}`);

    setIsTranscribingAudio(true);
    setVoiceError("");

    try {
      const response = await fetch("http://127.0.0.1:8000/transcribe-audio", {
        method: "POST",
        body: formData,
      });

      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      let payload = null;

      if (isJson) {
        try {
          payload = await response.json();
        } catch (parseError) {
          if (response.ok) {
            throw new Error("Réponse de transcription invalide.");
          }
        }
      }

      if (!response.ok) {
        const detail =
          (payload && typeof payload.detail === "string" && payload.detail) ||
          `Erreur serveur (${response.status})`;
        throw new Error(detail);
      }

      const transcript =
        payload && typeof payload.text === "string"
          ? payload.text.trim()
          : "";

      if (!transcript) {
        setVoiceError("La transcription est vide.");
        return;
      }

      setInput((previousInput) => joinWithSpace(previousInput, transcript));
      setVoiceError("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message || "Impossible de transcrire l'audio."
          : "Impossible de transcrire l'audio.";
      console.error("Impossible de transcrire l'audio", error);
      setVoiceError(message);
    } finally {
      setIsTranscribingAudio(false);
    }
  };

  const stopVoiceRecognition = async () => {
    if (!isVoiceSupported) {
      return;
    }

    if (voiceModeRef.current === VOICE_MODE_BROWSER) {
      const recognition = recognitionRef.current;

      if (!recognition) {
        return;
      }

      try {
        recognition.stop();
      } catch (error) {
        if (error?.name !== "InvalidStateError") {
          console.warn("Impossible d'arrêter la dictée vocale", error);
        }
      }

      return;
    }

    if (voiceModeRef.current === VOICE_MODE_FALLBACK) {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch (error) {
          if (error?.name !== "InvalidStateError") {
            console.warn("Impossible d'arrêter l'enregistrement audio", error);
          }
        }
      } else {
        cleanupMediaStream();
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        setIsListening(false);
      }
    }
  };

  const selectRecorderMimeType = () => {
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
      return null;
    }

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
    ];

    for (const candidate of candidates) {
      try {
        if (window.MediaRecorder.isTypeSupported(candidate)) {
          return candidate;
        }
      } catch (error) {
        console.warn("Type d'enregistrement audio non supporté", candidate, error);
      }
    }

    return null;
  };

  const startVoiceRecognition = async () => {
    if (!isVoiceSupported) {
      return;
    }

    stopHotwordDetection();

    if (voiceModeRef.current === VOICE_MODE_BROWSER) {
      const recognition = recognitionRef.current;

      if (!recognition) {
        return;
      }

      voiceCaptureStateRef.current = {
        base: input,
        final: "",
      };

      setVoiceError("");

      try {
        recognition.start();
      } catch (error) {
        if (error?.name !== "InvalidStateError") {
          console.error("Impossible de démarrer la dictée vocale", error);
          setVoiceError(
            "Impossible de démarrer la dictée vocale. Vérifie ton micro."
          );
        }
      }

      return;
    }

    if (voiceModeRef.current === VOICE_MODE_FALLBACK) {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setVoiceError("Microphone inaccessible dans ce navigateur.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const mimeType = selectRecorderMimeType();
        if (mimeType) {
          fallbackMimeTypeRef.current = mimeType;
        }

        const options = mimeType ? { mimeType } : undefined;
        const recorder = new window.MediaRecorder(stream, options);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];
        setVoiceError("");

        recorder.ondataavailable = (event) => {
          if (event?.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        recorder.onerror = (event) => {
          console.error("Erreur pendant l'enregistrement audio", event?.error ?? event);
          audioChunksRef.current = [];
          cleanupMediaStream();
          mediaRecorderRef.current = null;
          setIsListening(false);
          setVoiceError("Erreur pendant l'enregistrement audio.");
        };

        recorder.onstart = () => {
          setIsListening(true);
        };

        recorder.onstop = () => {
          const recordedChunks = audioChunksRef.current.slice();
          audioChunksRef.current = [];
          cleanupMediaStream();
          mediaRecorderRef.current = null;
          setIsListening(false);
          const recorderMime = recorder.mimeType || fallbackMimeTypeRef.current;
          processRecordedAudio(recordedChunks, recorderMime);
        };

        recorder.start();
      } catch (error) {
        console.error("Impossible de démarrer l'enregistrement audio", error);
        cleanupMediaStream();
        mediaRecorderRef.current = null;
        setIsListening(false);

        if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
          setVoiceError(
            "Accès au micro refusé. Vérifie les autorisations du navigateur."
          );
        } else if (error?.name === "NotFoundError") {
          setVoiceError("Microphone introuvable ou occupé.");
        } else {
          setVoiceError("Impossible d'accéder au micro. Réessaie.");
        }
      }
    }
  };

  useEffect(() => {
    startVoiceRecognitionRef.current = startVoiceRecognition;
  }, [startVoiceRecognition]);

  const toggleVoiceRecognition = async () => {
    if (!isVoiceSupported || isTranscribingAudio) {
      return;
    }

    if (isListening) {
      await stopVoiceRecognition();
    } else {
      await startVoiceRecognition();
    }
  };

  const startRealtimeSession = async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setRealtimeError("Microphone inaccessible dans ce navigateur.");
      setRealtimeStatus("idle");
      setIsRealtimeActive(false);
      return;
    }

    stopHotwordDetection();

    if (peerConnectionRef.current) {
      stopRealtimeSession();
    }

    setRealtimeError("");
    setRealtimeStatus("connecting");
    setIsRealtimeActive(true);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const message =
        error?.name === "NotAllowedError" || error?.name === "SecurityError"
          ? "Accès au micro refusé. Vérifie les autorisations du navigateur."
          : error?.name === "NotFoundError"
          ? "Microphone introuvable ou occupé."
          : "Impossible d'accéder au micro. Réessaie.";

      setRealtimeError(message);
      setIsRealtimeActive(false);
      setRealtimeStatus("idle");
      return;
    }

    realtimeStreamRef.current = stream;

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerConnectionRef.current = peerConnection;

    stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

    peerConnection.oniceconnectionstatechange = () => {
      if (peerConnectionRef.current !== peerConnection) {
        return;
      }

      const { iceConnectionState } = peerConnection;
      if (iceConnectionState === "connected" || iceConnectionState === "completed") {
        setRealtimeStatus((current) => (current === "connecting" ? "listening" : current));
        return;
      }

      if (iceConnectionState === "failed") {
        setRealtimeError("La connexion au service Realtime d'OpenAI a échoué.");
        stopRealtimeSession();
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnectionRef.current !== peerConnection) {
        return;
      }

      const { connectionState } = peerConnection;

      if (connectionState === "connected") {
        setRealtimeStatus("listening");
        return;
      }

      if (connectionState === "failed") {
        setRealtimeError("Connexion perdue avec le service Realtime d'OpenAI.");
        stopRealtimeSession();
        return;
      }

      if (connectionState === "disconnected" || connectionState === "closed") {
        setRealtimeError("Session vocale interrompue.");
        stopRealtimeSession();
      }
    };

    peerConnection.ontrack = (event) => {
      if (peerConnectionRef.current !== peerConnection) {
        return;
      }

      const [remoteStream] = event.streams;
      const audioElement = realtimeRemoteAudioRef.current;

      if (!remoteStream || !audioElement) {
        return;
      }

      audioElement.srcObject = remoteStream;

      audioElement.onplaying = () => {
        if (peerConnectionRef.current === peerConnection) {
          setRealtimeStatus("speaking");
        }
      };

      const backToListening = () => {
        if (peerConnectionRef.current === peerConnection) {
          setRealtimeStatus("listening");
        }
      };

      audioElement.onpause = backToListening;
      audioElement.onwaiting = backToListening;
      audioElement.onended = backToListening;

      const playPromise = audioElement.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          console.warn("Lecture audio distante impossible", error);
        });
      }
    };

    try {
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await peerConnection.setLocalDescription(offer);

      await new Promise((resolve) => {
        if (peerConnection.iceGatheringState === "complete") {
          resolve();
          return;
        }

        const checkState = () => {
          if (peerConnection.iceGatheringState === "complete") {
            peerConnection.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };

        peerConnection.addEventListener("icegatheringstatechange", checkState);
        setTimeout(() => {
          peerConnection.removeEventListener("icegatheringstatechange", checkState);
          resolve();
        }, 2500);
      });

      if (peerConnectionRef.current !== peerConnection) {
        return;
      }

      const localDescription = peerConnection.localDescription;

      if (!localDescription?.sdp) {
        throw new Error("Impossible de générer l'offre SDP locale.");
      }

      const url = new URL("http://127.0.0.1:8000/api/realtime/session");
      url.searchParams.set("model", REALTIME_MODEL);
      if (realtimeVoice) {
        url.searchParams.set("voice", realtimeVoice);
      }

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: localDescription.sdp,
      });

      const answerSdp = await response.text();

      if (peerConnectionRef.current !== peerConnection) {
        return;
      }

      if (!response.ok) {
        const detail =
          answerSdp ||
          `Erreur lors de la création de la session temps réel (${response.status}).`;
        throw new Error(detail);
      }

      await peerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });

      if (peerConnectionRef.current === peerConnection) {
        setRealtimeStatus("listening");
      }
    } catch (error) {
      if (peerConnectionRef.current !== peerConnection) {
        return;
      }

      console.error("Impossible d'établir la session vocale temps réel", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Impossible de démarrer la session vocale temps réel.";
      stopRealtimeSession();
      setRealtimeError(message);
    }
  };

  const toggleRealtimeSession = () => {
    if (isRealtimeActive) {
      stopRealtimeSession();
      setRealtimeError("");
      return;
    }

    startRealtimeSession();
  };

  const handleRealtimeVoiceChange = (event) => {
    setRealtimeVoice(event.target.value);
    setRealtimeError("");
  };

  const clearCopyFeedback = () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    setCopiedCodeKey(null);
  };

  const resetComposer = () => {
    stopRealtimeSession();
    setRealtimeError("");
    stopVoiceRecognition();
    audioChunksRef.current = [];
    cleanupMediaStream();
    mediaRecorderRef.current = null;
    voiceCaptureStateRef.current = { base: "", final: "" };
    setIsListening(false);
    setIsTranscribingAudio(false);
    setInput("");
    setSelectedFiles([]);
    setVoiceError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const appendMessageToConversation = (conversationId, message) => {
    setConversations((previousConversations) => {
      const existingConversation = previousConversations.find(
        (conversation) => conversation.id === conversationId
      );

      if (!existingConversation) {
        const fallbackTitle =
          message.sender === "user" && typeof message.text === "string"
            ? message.text.trim().split("\n")[0]
            : `Conversation ${conversationId}`;

        const truncatedTitle =
          fallbackTitle && fallbackTitle.length > 42
            ? `${fallbackTitle.slice(0, 39)}…`
            : fallbackTitle;

        const newConversation = {
          id: conversationId,
          title: truncatedTitle || `Conversation ${conversationId}`,
          messages: [message],
        };

        conversationCounterRef.current = Math.max(
          conversationCounterRef.current,
          conversationId
        );

        return [newConversation, ...previousConversations];
      }

      const updatedMessages = [...existingConversation.messages, message];
      const hasUserTitle = existingConversation.messages.some(
        (existingMessage) =>
          existingMessage.sender === "user" &&
          typeof existingMessage.text === "string" &&
          existingMessage.text.trim().length > 0
      );

      let updatedTitle = existingConversation.title;

      if (
        message.sender === "user" &&
        typeof message.text === "string" &&
        message.text.trim().length > 0 &&
        !hasUserTitle
      ) {
        const snippet = message.text.trim().split("\n")[0];
        updatedTitle =
          snippet.length > 42 ? `${snippet.slice(0, 39)}…` : snippet;
      }

      const updatedConversation = {
        ...existingConversation,
        title: updatedTitle,
        messages: updatedMessages,
      };

      const remainingConversations = previousConversations.filter(
        (conversation) => conversation.id !== conversationId
      );

      return [updatedConversation, ...remainingConversations];
    });
  };

  const updateLastMessageInConversation = (conversationId, updater) => {
    setConversations((previousConversations) => {
      const existingConversation = previousConversations.find(
        (conversation) => conversation.id === conversationId
      );

      if (!existingConversation || existingConversation.messages.length === 0) {
        return previousConversations;
      }

      const lastIndex = existingConversation.messages.length - 1;
      const currentMessage = existingConversation.messages[lastIndex];
      const updates = updater(currentMessage);

      if (!updates) {
        return previousConversations;
      }

      const updatedMessage = { ...currentMessage, ...updates };
      const updatedConversation = {
        ...existingConversation,
        messages: [
          ...existingConversation.messages.slice(0, lastIndex),
          updatedMessage,
        ],
      };

      const remainingConversations = previousConversations.filter(
        (conversation) => conversation.id !== conversationId
      );

      return [updatedConversation, ...remainingConversations];
    });
  };

  const handleSelectConversation = (conversationId) => {
    if (conversationId === activeConversationId) {
      return;
    }

    setActiveConversationId(conversationId);
    resetComposer();
    clearCopyFeedback();
    dragCounter.current = 0;
    setIsDragging(false);
  };

  const createNewConversation = () => {
    conversationCounterRef.current += 1;
    const newConversationId = conversationCounterRef.current;

    const newConversation = {
      id: newConversationId,
      title: `Conversation ${newConversationId}`,
      messages: [],
    };

    setConversations((previousConversations) => [
      newConversation,
      ...previousConversations,
    ]);
    setActiveConversationId(newConversationId);
    resetComposer();
    clearCopyFeedback();
    dragCounter.current = 0;
    setIsDragging(false);
  };

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ??
    conversations[0];
  const messages = activeConversation?.messages ?? [];
  const isActiveConversationLoading = loadingConversationIds.includes(
    activeConversationId
  );

  const voiceButtonLabel = isListening
    ? "Arrêter la dictée vocale"
    : isTranscribingAudio
    ? "Transcription audio en cours"
    : isRealtimeActive
    ? "Session vocale temps réel active"
    : "Activer la dictée vocale";
  const voiceButtonTitle = !hasCheckedVoiceSupport
    ? "Vérification du micro en cours..."
    : !isVoiceSupported
    ? "La commande vocale n'est pas disponible sur ce navigateur"
    : isTranscribingAudio
    ? "Transcription de l'enregistrement en cours..."
    : isRealtimeActive
    ? "La session vocale temps réel est en cours."
    : voiceButtonLabel;

  const realtimeStatusLabel = (() => {
    switch (realtimeStatus) {
      case "connecting":
        return "Connexion en cours…";
      case "listening":
        return "Jarvis écoute 👂";
      case "speaking":
        return "Jarvis parle 🗣️";
      default:
        return "Session en attente";
    }
  })();

  const realtimeStatusClassName = `realtime-status-indicator ${realtimeStatus}`;
  const realtimeButtonLabel = isRealtimeActive
    ? "Arrêter la session vocale"
    : "Démarrer la session vocale";
  const realtimeButtonIcon =
    isRealtimeActive && realtimeStatus !== "connecting"
      ? "🔇"
      : realtimeStatus === "connecting"
      ? "⏳"
      : "🎤";
  const isRealtimeToggleDisabled =
    !isRealtimeActive && (isListening || isTranscribingAudio);

  const wakeWordDisplay =
    WAKE_WORD.charAt(0).toUpperCase() + WAKE_WORD.slice(1);
  const speechRecognitionAvailable =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);
  const isWakeWordSupported = Boolean(
    speechRecognitionAvailable && recognitionRef.current
  );
  const isWakeWordActive =
    isWakeWordEnabled &&
    isWakeWordSupported &&
    !isListening &&
    !isTranscribingAudio &&
    !isRealtimeActive;
  const isWakeWordToggleDisabled =
    !hasCheckedVoiceSupport ||
    !isVoiceSupported ||
    !isWakeWordSupported ||
    isRealtimeActive ||
    isListening ||
    isTranscribingAudio;

  const handleWakeWordToggle = (event) => {
    const { checked } = event.target;

    if (!checked) {
      setIsWakeWordEnabled(false);
      setWakeWordError("");
      stopHotwordDetection();
      return;
    }

    if (!isWakeWordSupported) {
      setWakeWordError(
        "La détection par mot clé nécessite un navigateur compatible (Chrome, Edge…)."
      );
      return;
    }

    if (isRealtimeActive) {
      setWakeWordError(
        `Désactive la session vocale temps réel avant d'utiliser le déclencheur "${wakeWordDisplay}".`
      );
      return;
    }

    setWakeWordError("");
    setIsWakeWordEnabled(true);
  };

  const copyTextToClipboard = async (text) => {
    if (!text) {
      return false;
    }

    const supportsClipboardApi =
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function";

    if (supportsClipboardApi) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        console.warn("Échec de l'utilisation du presse-papiers natif", error);
      }
    }

    try {
      if (typeof document === "undefined") {
        return false;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      return successful;
    } catch (error) {
      console.error("Impossible de copier le texte", error);
      return false;
    }
  };

  const handleCopyCode = async (text, key) => {
    const didCopy = await copyTextToClipboard(text);

    if (!didCopy) {
      return;
    }

    setCopiedCodeKey(key);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = setTimeout(() => {
      setCopiedCodeKey(null);
    }, 2000);
  };

  const renderMessageContent = (message, messageIndex) => {
    const rawText =
      typeof message?.text === "string" ? message.text : "";
    const isStreaming = Boolean(message?.isStreaming);

    const hasRawText = rawText.length > 0;

    const normaliseNewlines = (value) => value.replace(/\r\n/g, "\n");
    const codeBlockRegex = /```([^\n\r]*)\r?\n?([\s\S]*?)```/g;

    const segments = [];
    let lastIndex = 0;
    let match;

    if (hasRawText) {
      while ((match = codeBlockRegex.exec(rawText)) !== null) {
        if (match.index > lastIndex) {
          const plainText = rawText.slice(lastIndex, match.index);
          segments.push({ type: "text", content: normaliseNewlines(plainText) });
        }

        const language = match[1]?.trim();
        const codeContent = normaliseNewlines(match[2] ?? "");

        segments.push({
          type: "code",
          content: codeContent,
          language: language || undefined,
        });

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < rawText.length) {
        const remainingText = rawText.slice(lastIndex);
        segments.push({
          type: "text",
          content: normaliseNewlines(remainingText),
        });
      }
    }

    const visibleSegments = segments.filter((segment) => {
      if (segment.type === "code") {
        return segment.content.trim() !== "";
      }

      return segment.content.trim() !== "";
    });

    const hasVisibleSegments = visibleSegments.length > 0;

    if (!hasVisibleSegments && !isStreaming) {
      return null;
    }

    return (
      <div className="message-content">
        {hasVisibleSegments &&
          visibleSegments.map((segment, index) => {
            if (segment.type === "code") {
              const codeKey = `${messageIndex}-code-${index}`;
              const rawLanguage = segment.language?.trim();
              const canonicalLanguage = normaliseLanguage(rawLanguage);
              const displayLanguage =
                (rawLanguage || canonicalLanguage)?.toUpperCase();
              const highlightedCode = highlightCode(
                segment.content,
                canonicalLanguage
              );

              return (
                <div key={codeKey} className="message-code-wrapper">
                  <div className="code-toolbar">
                    <div className="code-toolbar-meta" aria-hidden="true">
                      <span className="toolbar-dot" />
                      <span className="toolbar-dot" />
                      <span className="toolbar-dot" />
                      {displayLanguage ? (
                        <span className="toolbar-language">{displayLanguage}</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={`copy-button ${
                        copiedCodeKey === codeKey ? "copied" : ""
                      }`}
                      onClick={() => handleCopyCode(segment.content, codeKey)}
                      aria-label="Copier ce bloc de code"
                    >
                      {copiedCodeKey === codeKey ? "✅ Copié !" : "Copier le code"}
                    </button>
                  </div>
                  <pre
                    className="message-code-block"
                    data-language={displayLanguage || undefined}
                  >
                    <code
                      className={`code-content${
                        canonicalLanguage ? ` language-${canonicalLanguage}` : ""
                      }`}
                      dangerouslySetInnerHTML={{ __html: highlightedCode }}
                    />
                  </pre>
                </div>
              );
            }

            return (
              <Fragment key={`text-${index}`}>
                {renderRichText(
                  segment.content,
                  `${messageIndex}-text-${index}`
                )}
              </Fragment>
            );
          })}
        {isStreaming && (
          <div
            className="streaming-indicator"
            role="status"
            aria-live="polite"
          >
            {!hasVisibleSegments && (
              <span className="streaming-label">Jarvis rédige une réponse</span>
            )}
            <span className="streaming-dots" aria-hidden="true">
              <span className="streaming-dot" />
              <span className="streaming-dot" />
              <span className="streaming-dot" />
            </span>
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      voiceModeRef.current = VOICE_MODE_UNSUPPORTED;
      setIsVoiceSupported(false);
      setHasCheckedVoiceSupport(true);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      voiceModeRef.current = VOICE_MODE_BROWSER;
      const recognition = new SpeechRecognition();
      recognition.lang = "fr-FR";
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setVoiceError("");
      };

      recognition.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript ?? "";

          if (!transcript) {
            continue;
          }

          if (result.isFinal) {
            finalTranscript = joinWithSpace(
              finalTranscript,
              transcript.trim()
            );
          } else {
            interimTranscript = joinWithSpace(
              interimTranscript,
              transcript.trim()
            );
          }
        }

        if (!finalTranscript && !interimTranscript) {
          return;
        }

        if (finalTranscript) {
          voiceCaptureStateRef.current = {
            ...voiceCaptureStateRef.current,
            final: joinWithSpace(
              voiceCaptureStateRef.current.final,
              finalTranscript
            ),
          };
        }

        const combinedText = joinWithSpace(
          voiceCaptureStateRef.current.base,
          joinWithSpace(voiceCaptureStateRef.current.final, interimTranscript)
        );

        setInput(combinedText);
        setVoiceError("");
      };

      recognition.onerror = (event) => {
        let message = "La dictée vocale a rencontré une erreur.";

        switch (event.error) {
          case "not-allowed":
          case "service-not-allowed":
            message =
              "Accès au micro refusé. Vérifie les autorisations du navigateur.";
            break;
          case "no-speech":
            message = "Aucun son détecté. Réessaie.";
            break;
          case "audio-capture":
            message = "Microphone introuvable ou occupé.";
            break;
          default:
            break;
        }

        setIsListening(false);
        setVoiceError(message);
      };

      recognition.onend = () => {
        setIsListening(false);
        setInput((previousInput) => {
          const finalText = joinWithSpace(
            voiceCaptureStateRef.current.base,
            voiceCaptureStateRef.current.final
          );
          return finalText || previousInput;
        });
        voiceCaptureStateRef.current = { base: "", final: "" };
      };

      recognitionRef.current = recognition;
      setIsVoiceSupported(true);
      setHasCheckedVoiceSupport(true);

      return () => {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;

        try {
          recognition.stop();
        } catch (error) {
          if (error?.name !== "InvalidStateError") {
            console.warn(
              "Impossible d'arrêter la dictée vocale lors du nettoyage",
              error
            );
          }
        }

        recognitionRef.current = null;
        voiceCaptureStateRef.current = { base: "", final: "" };
        setIsListening(false);
        voiceModeRef.current = VOICE_MODE_UNSUPPORTED;
      };
    }

    const hasMediaRecorder =
      typeof window.MediaRecorder !== "undefined" &&
      typeof window.MediaRecorder === "function";
    const canUseMicrophone =
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function";

    if (hasMediaRecorder && canUseMicrophone) {
      voiceModeRef.current = VOICE_MODE_FALLBACK;
      setIsVoiceSupported(true);
      setHasCheckedVoiceSupport(true);

      return () => {
        cleanupMediaStream();
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        setIsListening(false);
        voiceModeRef.current = VOICE_MODE_UNSUPPORTED;
      };
    }

    voiceModeRef.current = VOICE_MODE_UNSUPPORTED;
    setIsVoiceSupported(false);
    setHasCheckedVoiceSupport(true);
  }, []);

  useEffect(() => {
    if (!isWakeWordEnabled) {
      stopHotwordDetection();
      return;
    }

    if (!isWakeWordSupported) {
      stopHotwordDetection();
      setWakeWordError(
        "La détection par mot clé nécessite un navigateur compatible (Chrome, Edge…)."
      );
      setIsWakeWordEnabled(false);
      return;
    }

    if (isListening || isTranscribingAudio || isRealtimeActive) {
      stopHotwordDetection();
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      stopHotwordDetection();
      setWakeWordError(
        "La détection par mot clé nécessite un navigateur compatible (Chrome, Edge…)."
      );
      setIsWakeWordEnabled(false);
      return;
    }

    let cancelled = false;

    const launchDetection = () => {
      if (cancelled || hotwordRecognitionRef.current) {
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = "fr-FR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      hotwordManualStopRef.current = false;

      recognition.onresult = (event) => {
        if (cancelled) {
          return;
        }

        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          const result = event.results[index];
          const transcript = result[0]?.transcript ?? "";

          if (!transcript) {
            continue;
          }

          if (!WAKE_WORD_PATTERN.test(transcript)) {
            continue;
          }

          const now = Date.now();
          if (now - hotwordCooldownTimestampRef.current < HOTWORD_COOLDOWN_MS) {
            continue;
          }

          hotwordCooldownTimestampRef.current = now;

          stopHotwordDetection();

          if (hotwordActivationTimeoutRef.current) {
            clearTimeout(hotwordActivationTimeoutRef.current);
          }

          hotwordActivationTimeoutRef.current = window.setTimeout(() => {
            hotwordActivationTimeoutRef.current = null;

            if (
              !isWakeWordEnabledRef.current ||
              isListeningRef.current ||
              isTranscribingAudioRef.current ||
              isRealtimeActiveRef.current
            ) {
              return;
            }

            const starter = startVoiceRecognitionRef.current;
            if (typeof starter === "function") {
              starter();
            }
          }, 120);

          break;
        }
      };

      recognition.onerror = (event) => {
        if (cancelled) {
          return;
        }

        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          stopHotwordDetection();
          setWakeWordError(
            `Autorise le micro pour utiliser le déclencheur "${wakeWordDisplay}".`
          );
          setIsWakeWordEnabled(false);
          return;
        }

        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }

        console.warn("Erreur de détection du mot clé", event.error);
      };

      recognition.onend = () => {
        hotwordRecognitionRef.current = null;

        if (
          cancelled ||
          hotwordManualStopRef.current ||
          !isWakeWordEnabledRef.current
        ) {
          return;
        }

        hotwordRestartTimeoutRef.current = window.setTimeout(() => {
          if (!cancelled && isWakeWordEnabledRef.current) {
            launchDetection();
          }
        }, HOTWORD_RESTART_DELAY_MS);
      };

      try {
        recognition.start();
        hotwordRecognitionRef.current = recognition;
        setWakeWordError((previous) => (previous ? "" : previous));
      } catch (error) {
        if (
          error?.name === "NotAllowedError" ||
          error?.name === "SecurityError"
        ) {
          stopHotwordDetection();
          setWakeWordError(
            `Autorise le micro pour utiliser le déclencheur "${wakeWordDisplay}".`
          );
          setIsWakeWordEnabled(false);
        } else if (error?.name !== "InvalidStateError") {
          console.warn("Impossible de démarrer la détection du mot clé", error);
        }
      }
    };

    launchDetection();

    return () => {
      cancelled = true;
      stopHotwordDetection();
    };
  }, [
    isWakeWordEnabled,
    isWakeWordSupported,
    isListening,
    isTranscribingAudio,
    isRealtimeActive,
    stopHotwordDetection,
  ]);

  useEffect(() => {
    return () => {
      clearCopyFeedback();
    };
  }, []);

  useEffect(() => {
    return () => {
      stopRealtimeSession();
    };
  }, [stopRealtimeSession]);

  useEffect(() => {
    if (
      conversations.length > 0 &&
      !conversations.some((conversation) => conversation.id === activeConversationId)
    ) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  const sendMessage = async () => {
    if (isListening) {
      await stopVoiceRecognition();
    }

    const trimmedInput = input.trim();
    const hasAttachments = selectedFiles.length > 0;

    if (isActiveConversationLoading) {
      return;
    }

    if (!trimmedInput && !hasAttachments) {
      return;
    }

    const conversationIdForRequest = activeConversation?.id;

    if (!conversationIdForRequest) {
      return;
    }

    const messageText = input;
    const filesToSend = selectedFiles;
    const attachmentSummaries = filesToSend.map((file) => ({
      name: file.name,
      type: file.type,
    }));

    const userMsg = {
      sender: "user",
      text: messageText,
      attachments: attachmentSummaries,
    };

    appendMessageToConversation(conversationIdForRequest, userMsg);
    resetComposer();

    try {
      setLoadingConversationIds((previousIds) => {
        if (previousIds.includes(conversationIdForRequest)) {
          return previousIds;
        }

        return [...previousIds, conversationIdForRequest];
      });

      const placeholderBotMessage = {
        sender: "bot",
        text: "",
        isStreaming: true,
      };
      appendMessageToConversation(conversationIdForRequest, placeholderBotMessage);

      const formData = new FormData();
      formData.append("text", messageText);
      filesToSend.forEach((file) => {
        formData.append("files", file);
      });
      formData.append("stream", "true");

      const res = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Erreur serveur (${res.status})`);
      }

      const contentType = res.headers.get("content-type") || "";
      const isTextResponse = contentType.includes("text/");
      const isJsonResponse = contentType.includes("application/json");
      const textDecoder = new TextDecoder();
      let aggregatedResponse = "";

      if (res.body && isTextResponse) {
        const reader = res.body.getReader();

        while (true) {
          const { value, done } = await reader.read();

          if (value) {
            const chunkValue = textDecoder.decode(value, { stream: !done });
            if (chunkValue) {
              aggregatedResponse += chunkValue;
              updateLastMessageInConversation(
                conversationIdForRequest,
                (current) => ({
                  text: `${current.text || ""}${chunkValue}`,
                })
              );
            }
          }

          if (done) {
            break;
          }
        }

        const tail = textDecoder.decode();
        if (tail) {
          aggregatedResponse += tail;
          updateLastMessageInConversation(conversationIdForRequest, (current) => ({
            text: `${current.text || ""}${tail}`,
          }));
        }
      } else if (isJsonResponse) {
        const data = await res.json();
        aggregatedResponse =
          typeof data?.response === "string"
            ? data.response
            : JSON.stringify(data);
      } else {
        aggregatedResponse = await res.text();
      }

      const finalResponseText =
        aggregatedResponse && aggregatedResponse.trim().length > 0
          ? aggregatedResponse
          : "(Réponse vide)";

      updateLastMessageInConversation(conversationIdForRequest, () => ({
        text: finalResponseText,
        isStreaming: false,
      }));
    } catch (error) {
      console.error("Erreur lors de l'envoi du message", error);
      updateLastMessageInConversation(conversationIdForRequest, () => ({
        text: "⚠️ Erreur : impossible de contacter le serveur.",
        isStreaming: false,
      }));
    } finally {
      setLoadingConversationIds((previousIds) =>
        previousIds.filter((id) => id !== conversationIdForRequest)
      );
    }
  };

  const handleFileSelection = (files) => {
    const fileArray = Array.from(files || []);
    if (fileArray.length === 0) return;

    setSelectedFiles((prev) => {
      const existingSignatures = new Set(
        prev.map((file) => `${file.name}-${file.lastModified}-${file.size}`)
      );

      const uniqueNewFiles = fileArray.filter(
        (file) => !existingSignatures.has(`${file.name}-${file.lastModified}-${file.size}`)
      );

      if (uniqueNewFiles.length === 0) {
        return prev;
      }

      return [...prev, ...uniqueNewFiles];
    });
  };

  const handleFileChange = (event) => {
    handleFileSelection(event.target.files);
    event.target.value = "";
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    handleFileSelection(event.dataTransfer?.files);
  };

  const removeFileAtIndex = (indexToRemove) => {
    setSelectedFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
  }, [messages, activeConversationId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-brand">🤖 Jarvis</span>
          <button
            type="button"
            className="new-conversation-button"
            onClick={createNewConversation}
          >
            + Nouvelle conversation
          </button>
        </div>
        <div
          className="conversation-list"
          role="navigation"
          aria-label="Historique des conversations"
        >
          {conversations.length === 0 ? (
            <p className="conversation-empty">Aucune conversation</p>
          ) : (
            conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;
              const lastMessage =
                conversation.messages[conversation.messages.length - 1];

              let previewText = "Nouvelle conversation";

              if (lastMessage) {
                if (lastMessage.isStreaming) {
                  previewText = "Réponse en cours…";
                } else if (
                  typeof lastMessage.text === "string" &&
                  lastMessage.text.trim().length > 0
                ) {
                  previewText = lastMessage.text.trim().split("\n")[0];
                } else if (lastMessage.attachments?.length) {
                  const count = lastMessage.attachments.length;
                  previewText =
                    count === 1
                      ? "📎 1 fichier joint"
                      : `📎 ${count} fichiers joints`;
                } else {
                  previewText = "Message vide";
                }
              }

              if (previewText.length > 60) {
                previewText = `${previewText.slice(0, 57)}…`;
              }

              const isConversationLoading = loadingConversationIds.includes(
                conversation.id
              );
              const messageCount = conversation.messages.length;
              const metaText = isConversationLoading
                ? "Réponse en cours…"
                : messageCount === 0
                ? "Aucun message"
                : `${messageCount} message${messageCount > 1 ? "s" : ""}`;

              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-item${
                    isActive ? " active" : ""
                  }`}
                  onClick={() => handleSelectConversation(conversation.id)}
                  aria-current={isActive ? "page" : undefined}
                  title={conversation.title}
                >
                  <span className="conversation-title-text">
                    {conversation.title || `Conversation ${conversation.id}`}
                  </span>
                  <span className="conversation-preview">{previewText}</span>
                  <span className="conversation-meta">{metaText}</span>
                </button>
              );
            })
          )}
        </div>
      </aside>
      <div className="app-container">
        <header className="app-header">
          🤖 Jarvis — {activeConversation?.title || "Nouvelle conversation"}
        </header>

        <main ref={chatRef} className="chat-container" aria-live="polite">
          {messages.length === 0 && (
            <p className="empty-message">
              💬 Dis bonjour à Jarvis pour commencer
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={`${activeConversation?.id ?? "conversation"}-${i}`}
              className={`message ${m.sender === "user" ? "user" : "bot"}`}
            >
              <div className="bubble">
                {renderMessageContent(m, i)}
                {m.attachments?.length > 0 && (
                  <ul className="attachment-list">
                    {m.attachments.map((file, idx) => (
                      <li
                        key={`${file.name}-${idx}`}
                        className="attachment-pill"
                      >
                        📎 {file.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </main>

        <footer className="input-bar">
          <section className="realtime-voice-panel" aria-label="Dialogue vocal temps réel">
            <div className="realtime-voice-header">
              <p className="realtime-voice-title">🗣️ Dialogue vocal temps réel</p>
              <label className="realtime-voice-voice-picker">
                Voix
                <select
                  value={realtimeVoice}
                  onChange={handleRealtimeVoiceChange}
                  disabled={isRealtimeActive || realtimeStatus === "connecting"}
                  aria-label="Voix synthétique utilisée par Jarvis"
                >
                  {REALTIME_VOICES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="realtime-voice-controls">
              <button
                type="button"
                className={`realtime-voice-button${
                  isRealtimeActive ? " active" : ""
                }`}
                onClick={toggleRealtimeSession}
                disabled={isRealtimeToggleDisabled}
                aria-pressed={isRealtimeActive}
                aria-label={realtimeButtonLabel}
              >
                <span aria-hidden="true">{realtimeButtonIcon}</span>
                <span className="realtime-voice-button-label">{realtimeButtonLabel}</span>
              </button>
              <div className={realtimeStatusClassName} role="status" aria-live="polite">
                <span className="realtime-status-dot" aria-hidden="true" />
                <span className="realtime-status-text">{realtimeStatusLabel}</span>
              </div>
            </div>
            {realtimeError ? (
              <p className="realtime-voice-error" role="alert">⚠️ {realtimeError}</p>
            ) : (
              <p className="realtime-voice-hint">
                {isRealtimeActive
                  ? "Parle librement, Jarvis répond en direct."
                  : "Clique sur 🎤 pour démarrer un échange vocal instantané."}
              </p>
            )}
            <audio
              ref={realtimeRemoteAudioRef}
              className="realtime-audio-element"
              autoPlay
              playsInline
            />
          </section>
          <div
            className={`input-wrapper ${isDragging ? "dragging" : ""} ${
              isActiveConversationLoading ? "waiting" : ""
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <label className="file-input-label" title="Ajouter des fichiers">
              📎
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
              />
            </label>
            <button
              type="button"
              className={`voice-input-button${
                isListening ? " listening" : ""
              }`}
              onClick={toggleVoiceRecognition}
              disabled={
                !hasCheckedVoiceSupport ||
                !isVoiceSupported ||
                isActiveConversationLoading ||
                isTranscribingAudio ||
                isRealtimeActive
              }
              aria-pressed={isListening}
              aria-label={voiceButtonLabel}
              title={voiceButtonTitle}
            >
              <span aria-hidden="true">
                {isListening ? "⏹️" : isTranscribingAudio ? "⏳" : "🎙️"}
              </span>
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Écris ton message ici... (Entrée pour envoyer ou glisser-déposer des fichiers)"
              aria-label="Message à envoyer à Jarvis"
            />
          </div>
          {isActiveConversationLoading && (
            <div className="conversation-loading-hint">
              ✨ Jarvis rédige une réponse...
            </div>
          )}
          {selectedFiles.length > 0 && (
            <div className="pending-attachments">
              {selectedFiles.map((file, index) => (
                <span
                  key={`${file.name}-${file.lastModified}-${index}`}
                  className="attachment-pill pending"
                >
                  <span className="pill-name">📎 {file.name}</span>
                  <button
                    type="button"
                    className="pill-remove"
                    onClick={() => removeFileAtIndex(index)}
                    aria-label={`Retirer ${file.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="wake-word-toggle">
            <label>
              <input
                type="checkbox"
                checked={isWakeWordEnabled && isWakeWordSupported}
                onChange={handleWakeWordToggle}
                disabled={isWakeWordToggleDisabled}
              />
              <span>
                Dire « {wakeWordDisplay} » pour démarrer la dictée
              </span>
            </label>
          </div>
          {isWakeWordActive && (
            <div className="voice-support-hint" role="status">
              🎙️ Dis « {wakeWordDisplay} » pour lancer la dictée automatiquement.
            </div>
          )}
          {wakeWordError && (
            <div className="voice-support-hint error" role="alert">
              🎙️ {wakeWordError}
            </div>
          )}
          {isListening && (
            <div className="voice-support-hint active" role="status">
              🎙️ Dictée vocale en cours… parle librement.
            </div>
          )}
          {isTranscribingAudio && !isListening && (
            <div className="voice-support-hint active" role="status">
              🎙️ Transcription de l'audio en cours…
            </div>
          )}
          {voiceError && (
            <div className="voice-support-hint error" role="alert">
              🎙️ {voiceError}
            </div>
          )}
          {hasCheckedVoiceSupport && !isVoiceSupported && !voiceError && (
            <div className="voice-support-hint" role="note">
              🎙️ La commande vocale nécessite un navigateur compatible (Chrome, Edge, Opera GX…).
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;
