import { Fragment, useEffect, useRef, useState } from "react";
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
  const conversationCounterRef = useRef(1);
  const chatRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const copyTimeoutRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceCaptureStateRef = useRef({ base: "", final: "" });
  const voiceModeRef = useRef(VOICE_MODE_UNSUPPORTED);
  const sendMessageRef = useRef(async () => {});
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fallbackMimeTypeRef = useRef("audio/webm");
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);

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
        } catch {
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

      let combinedText = "";
      setInput((previousInput) => {
        const nextInput = joinWithSpace(previousInput, transcript);
        combinedText = nextInput;
        return nextInput;
      });
      setVoiceError("");

      if (typeof combinedText === "string" && combinedText.trim().length > 0) {
        sendMessageRef.current(combinedText);
      }
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

  const clearCopyFeedback = () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    setCopiedCodeKey(null);
  };

  const resetComposer = () => {
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
    : "Activer la dictée vocale";
  const voiceButtonTitle = !hasCheckedVoiceSupport
    ? "Vérification du micro en cours..."
    : !isVoiceSupported
    ? "La commande vocale n'est pas disponible sur ce navigateur"
    : isTranscribingAudio
    ? "Transcription de l'enregistrement en cours..."
    : voiceButtonLabel;

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

        const baseText = voiceCaptureStateRef.current.base;
        const finalTranscript = voiceCaptureStateRef.current.final;
        const combinedText = joinWithSpace(baseText, finalTranscript);
        const hasFinalTranscript =
          typeof finalTranscript === "string" && finalTranscript.trim().length > 0;

        if (hasFinalTranscript) {
          setInput(combinedText);
          sendMessageRef.current(combinedText);
        } else {
          setInput((previousInput) => combinedText || previousInput);
        }

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
    return () => {
      clearCopyFeedback();
    };
  }, []);

  useEffect(() => {
    if (
      conversations.length > 0 &&
      !conversations.some((conversation) => conversation.id === activeConversationId)
    ) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  const sendMessage = async (overrideText) => {
    if (isListening) {
      await stopVoiceRecognition();
    }

    const messageToSend =
      typeof overrideText === "string" ? overrideText : input;
    const trimmedMessage = messageToSend.trim();
    const filesToSend = selectedFiles.slice();
    const hasAttachments = filesToSend.length > 0;

    if (isActiveConversationLoading) {
      return;
    }

    if (!trimmedMessage && !hasAttachments) {
      return;
    }

    const conversationIdForRequest = activeConversation?.id;

    if (!conversationIdForRequest) {
      return;
    }

    const attachmentSummaries = filesToSend.map((file) => ({
      name: file.name,
      type: file.type,
    }));

    const userMsg = {
      sender: "user",
      text: messageToSend,
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
      formData.append("text", messageToSend);
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

  sendMessageRef.current = sendMessage;

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
                isTranscribingAudio
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
