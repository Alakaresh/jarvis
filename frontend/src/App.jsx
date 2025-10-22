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

const DEFAULT_AUDIO_FORMAT = "pcm16";
const PCM_SAMPLE_RATE = 24000;

const decodeBase64ToUint8Array = (base64) => {
  if (typeof window === "undefined" || typeof base64 !== "string") {
    return new Uint8Array(0);
  }

  try {
    const binaryString = window.atob(base64);
    const { length } = binaryString;
    const bytes = new Uint8Array(length);

    for (let index = 0; index < length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }

    return bytes;
  } catch (error) {
    console.warn("Impossible de décoder le flux audio", error);
    return new Uint8Array(0);
  }
};

const decodeBase64ToInt16Array = (base64) => {
  const bytes = decodeBase64ToUint8Array(base64);

  if (bytes.byteLength === 0) {
    return new Int16Array(0);
  }

  const usableLength = bytes.byteLength - (bytes.byteLength % 2);

  if (usableLength <= 0) {
    return new Int16Array(0);
  }

  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + usableLength
  );
  return new Int16Array(buffer);
};

const mergePcm16Chunks = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return new Int16Array(0);
  }

  const decodedChunks = chunks
    .map((chunk) => decodeBase64ToInt16Array(chunk))
    .filter((chunk) => chunk.length > 0);

  if (decodedChunks.length === 0) {
    return new Int16Array(0);
  }

  const totalLength = decodedChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0
  );
  const merged = new Int16Array(totalLength);
  let offset = 0;

  decodedChunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });

  return merged;
};

const createWavBlobFromPcm16 = (
  pcm16Data,
  sampleRate = PCM_SAMPLE_RATE
) => {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm16Data.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const pcmView = new Int16Array(buffer, 44);
  pcmView.set(pcm16Data);

  return new Blob([buffer], { type: "audio/wav" });
};

const createAudioUrlFromChunks = (
  chunks,
  format = DEFAULT_AUDIO_FORMAT,
  sampleRate = PCM_SAMPLE_RATE
) => {
  if (typeof window === "undefined") {
    return null;
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return null;
  }

  const normalizedFormat =
    typeof format === "string"
      ? format.trim().toLowerCase() || DEFAULT_AUDIO_FORMAT
      : DEFAULT_AUDIO_FORMAT;

  if (normalizedFormat === "pcm16") {
    const merged = mergePcm16Chunks(chunks);

    if (merged.length === 0) {
      return null;
    }

    const wavBlob = createWavBlobFromPcm16(merged, sampleRate);
    return URL.createObjectURL(wavBlob);
  }

  const byteChunks = chunks
    .map((chunk) => decodeBase64ToUint8Array(chunk))
    .filter((chunk) => chunk.byteLength > 0);

  if (byteChunks.length === 0) {
    return null;
  }

  const totalLength = byteChunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0
  );
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  byteChunks.forEach((chunk) => {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  });

  const mimeType =
    normalizedFormat === "mp3"
      ? "audio/mpeg"
      : `audio/${normalizedFormat}`;

  return URL.createObjectURL(new Blob([combined.buffer], { type: mimeType }));
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
  const [isVoiceReady, setIsVoiceReady] = useState(false);
  const [isVoiceActivating, setIsVoiceActivating] = useState(false);
  const [voiceActivationError, setVoiceActivationError] = useState(null);
  const conversationCounterRef = useRef(1);
  const chatRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const copyTimeoutRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioPlaybackTimeRef = useRef(0);
  const audioObjectUrlsRef = useRef(new Set());
  const voiceActivationPromiseRef = useRef(null);

  const clearCopyFeedback = () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    setCopiedCodeKey(null);
  };

  const resetComposer = () => {
    setInput("");
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const ensureAudioContext = async (options = {}) => {
    const { onError } = options ?? {};

    if (typeof window === "undefined") {
      if (typeof onError === "function") {
        onError("unavailable");
      }
      return null;
    }

    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        console.warn("AudioContext non disponible dans ce navigateur");
        if (typeof onError === "function") {
          onError("unsupported");
        }
        return null;
      }

      try {
        audioContextRef.current = new AudioContextClass();
      } catch (error) {
        console.warn("Impossible d'initialiser l'AudioContext", error);
        if (typeof onError === "function") {
          onError("creation-error", error);
        }
        return null;
      }
    }

    const context = audioContextRef.current;

    if (!context) {
      if (typeof onError === "function") {
        onError("creation-error");
      }
      return null;
    }

    const needsResume =
      context.state === "suspended" || context.state === "interrupted";

    if (needsResume) {
      try {
        await context.resume();
      } catch (error) {
        console.warn("Impossible de reprendre l'AudioContext", error);
        if (typeof onError === "function") {
          onError("resume-error", error);
        }
        return null;
      }
    }

    if (context.state === "closed") {
      if (typeof onError === "function") {
        onError("closed");
      }
      return null;
    }

    if (context.state !== "running") {
      if (typeof onError === "function") {
        onError("resume-blocked");
      }
      return null;
    }

    return context;
  };

  const getVoiceActivationMessage = (reason) => {
    switch (reason) {
      case "unsupported":
        return "La lecture audio n'est pas prise en charge par ce navigateur.";
      case "creation-error":
        return "Impossible d'initialiser le lecteur audio. Vérifie les autorisations de ton navigateur.";
      case "resume-error":
      case "resume-blocked":
        return "Le navigateur a bloqué l'activation audio. Clique à nouveau ou autorise la lecture automatique du son.";
      case "closed":
        return "Le lecteur audio a été fermé. Recharge la page pour réessayer.";
      case "unavailable":
        return "Le contexte audio est indisponible dans cet environnement.";
      default:
        return "Impossible d'activer la lecture audio pour le moment.";
    }
  };

  const handleActivateVoice = async () => {
    if (voiceActivationPromiseRef.current) {
      return voiceActivationPromiseRef.current;
    }

    const activationPromise = (async () => {
      setIsVoiceActivating(true);
      setVoiceActivationError(null);

      try {
        const context = await ensureAudioContext({
          onError: (reason) => {
            setVoiceActivationError(getVoiceActivationMessage(reason));
          },
        });

        if (!context || context.state === "closed") {
          setIsVoiceReady(false);
          setVoiceActivationError((previous) =>
            previous ?? getVoiceActivationMessage("closed")
          );
          return null;
        }

        const currentTime =
          typeof context.currentTime === "number" ? context.currentTime : 0;
        const previousPlayback =
          typeof audioPlaybackTimeRef.current === "number"
            ? audioPlaybackTimeRef.current
            : 0;

        audioPlaybackTimeRef.current = Math.max(previousPlayback, currentTime);
        setIsVoiceReady(true);
        setVoiceActivationError(null);
        return context;
      } catch (error) {
        console.warn("Impossible d'activer la lecture audio", error);
        setVoiceActivationError((previous) =>
          previous ?? getVoiceActivationMessage("unknown")
        );
        setIsVoiceReady(false);
        return null;
      } finally {
        setIsVoiceActivating(false);
        voiceActivationPromiseRef.current = null;
      }
    })();

    voiceActivationPromiseRef.current = activationPromise;
    return activationPromise;
  };

  const playPcmChunk = async (
    base64Chunk,
    sampleRate = PCM_SAMPLE_RATE
  ) => {
    if (!base64Chunk) {
      return;
    }

    let context = audioContextRef.current;

    if (!context) {
      context = await ensureAudioContext();
    }

    if (!context) {
      return;
    }

    const pcmData = decodeBase64ToInt16Array(base64Chunk);

    if (pcmData.length === 0) {
      return;
    }

    const float32 = new Float32Array(pcmData.length);

    for (let index = 0; index < pcmData.length; index += 1) {
      float32[index] = Math.max(-1, pcmData[index] / 32768);
    }

    try {
      const buffer = context.createBuffer(
        1,
        float32.length,
        sampleRate || PCM_SAMPLE_RATE
      );
      buffer.copyToChannel(float32, 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);

      const currentPlaybackTime =
        typeof audioPlaybackTimeRef.current === "number"
          ? audioPlaybackTimeRef.current
          : 0;
      const startAt = Math.max(currentPlaybackTime, context.currentTime);

      source.start(startAt);
      audioPlaybackTimeRef.current = startAt + buffer.duration;
    } catch (error) {
      console.warn("Impossible de jouer un morceau audio", error);
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
    const audioUrl =
      typeof message?.audioUrl === "string" && message.audioUrl.length > 0
        ? message.audioUrl
        : null;
    const hasAudio = Boolean(audioUrl);

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

    if (!hasVisibleSegments && !hasAudio && !isStreaming) {
      return null;
    }

    return (
      <div className="message-content">
        {hasAudio ? (
          <div className="audio-player-wrapper">
            <audio
              className="message-audio-player"
              controls
              src={audioUrl}
              preload="auto"
            >
              Votre navigateur ne supporte pas la lecture audio.
            </audio>
          </div>
        ) : null}
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
    return () => {
      clearCopyFeedback();
      if (typeof window !== "undefined") {
        audioObjectUrlsRef.current.forEach((url) => {
          try {
            URL.revokeObjectURL(url);
          } catch (error) {
            console.warn("Impossible de libérer l'URL audio", error);
          }
        });
      }
      audioObjectUrlsRef.current.clear();

      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch (error) {
          console.warn("Impossible de fermer l'AudioContext", error);
        }
        audioContextRef.current = null;
      }
      voiceActivationPromiseRef.current = null;
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

  const sendMessage = async () => {
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
        audioUrl: null,
        audioFormat: null,
        audioSampleRate: null,
      };
      appendMessageToConversation(conversationIdForRequest, placeholderBotMessage);

      let audioContext = null;

      if (!isVoiceReady) {
        audioContext = await handleActivateVoice();
      }

      if (!audioContext) {
        audioContext = await ensureAudioContext();
      }
      if (audioContext) {
        const previousPlayback =
          typeof audioPlaybackTimeRef.current === "number"
            ? audioPlaybackTimeRef.current
            : 0;
        audioPlaybackTimeRef.current = Math.max(
          previousPlayback,
          audioContext.currentTime
        );
        if (audioContext.state !== "closed") {
          setIsVoiceReady(true);
        }
      }

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

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const isNdjsonResponse = contentType.includes("application/x-ndjson");
      const isTextResponse = contentType.includes("text/");
      const isJsonResponse = contentType.includes("application/json");
      const textDecoder = new TextDecoder();
      let aggregatedResponse = "";
      const audioChunks = [];
      let audioFormat = null;
      let audioSampleRate = null;

      const processNdjsonLine = async (line) => {
        if (!line) {
          return;
        }

        let payload;

        try {
          payload = JSON.parse(line);
        } catch (parseError) {
          console.warn("Chunk de flux invalide", parseError);
          return;
        }

        const payloadType =
          typeof payload?.type === "string" ? payload.type : "";

        if (payloadType === "text-delta" && typeof payload.text === "string") {
          if (payload.text.length > 0) {
            aggregatedResponse += payload.text;
            updateLastMessageInConversation(
              conversationIdForRequest,
              (current) => ({
                text: `${current.text || ""}${payload.text}`,
              })
            );
          }
          return;
        }

        if (payloadType === "audio-delta" && typeof payload.audio === "string") {
          audioChunks.push(payload.audio);

          if (typeof payload.audio_format === "string") {
            audioFormat = payload.audio_format;
          }

          if (typeof payload.audio_sample_rate === "number") {
            audioSampleRate = payload.audio_sample_rate;
          }

          updateLastMessageInConversation(
            conversationIdForRequest,
            (current) => {
              const updates = {};
              let hasUpdate = false;

              if (
                !current.audioFormat &&
                typeof payload.audio_format === "string"
              ) {
                updates.audioFormat = payload.audio_format;
                hasUpdate = true;
              }

              if (
                !current.audioSampleRate &&
                typeof payload.audio_sample_rate === "number"
              ) {
                updates.audioSampleRate = payload.audio_sample_rate;
                hasUpdate = true;
              }

              return hasUpdate ? updates : null;
            }
          );

          const resolvedFormat =
            (audioFormat || DEFAULT_AUDIO_FORMAT).toLowerCase();
          if (resolvedFormat === "pcm16") {
            await playPcmChunk(
              payload.audio,
              audioSampleRate || PCM_SAMPLE_RATE
            );
          }
        }
      };

      if (res.body && (isTextResponse || isNdjsonResponse)) {
        const reader = res.body.getReader();
        let bufferedText = "";

        while (true) {
          const { value, done } = await reader.read();

          if (value) {
            const chunkValue = textDecoder.decode(value, { stream: !done });

            if (isNdjsonResponse) {
              bufferedText += chunkValue;
              let newlineIndex;

              while ((newlineIndex = bufferedText.indexOf("\n")) !== -1) {
                const rawLine = bufferedText.slice(0, newlineIndex);
                bufferedText = bufferedText.slice(newlineIndex + 1);
                const trimmedLine = rawLine.trim();

                if (trimmedLine) {
                  await processNdjsonLine(trimmedLine);
                }
              }
            } else if (chunkValue) {
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

        if (isNdjsonResponse) {
          const finalRemainder = (bufferedText + textDecoder.decode()).trim();
          if (finalRemainder) {
            await processNdjsonLine(finalRemainder);
          }
        } else {
          const tail = textDecoder.decode();
          if (tail) {
            aggregatedResponse += tail;
            updateLastMessageInConversation(
              conversationIdForRequest,
              (current) => ({
                text: `${current.text || ""}${tail}`,
              })
            );
          }
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

      const normalizedAudioFormat = (
        audioFormat || DEFAULT_AUDIO_FORMAT
      ).toLowerCase();

      const finalResponseText =
        aggregatedResponse && aggregatedResponse.trim().length > 0
          ? aggregatedResponse
          : audioChunks.length > 0
          ? "(Réponse vocale)"
          : "(Réponse vide)";

      let finalAudioUrl = null;

      if (audioChunks.length > 0) {
        finalAudioUrl = createAudioUrlFromChunks(
          audioChunks,
          normalizedAudioFormat,
          audioSampleRate || PCM_SAMPLE_RATE
        );
      }

      let urlToRevoke = null;

      updateLastMessageInConversation(
        conversationIdForRequest,
        (current) => {
          if (current.audioUrl && current.audioUrl !== finalAudioUrl) {
            urlToRevoke = current.audioUrl;
          }

          return {
            text: finalResponseText,
            isStreaming: false,
            audioUrl: finalAudioUrl || null,
            audioFormat:
              audioChunks.length > 0 ? normalizedAudioFormat : null,
            audioSampleRate:
              audioChunks.length > 0
                ? audioSampleRate || PCM_SAMPLE_RATE
                : null,
          };
        }
      );

      if (urlToRevoke && typeof window !== "undefined") {
        try {
          URL.revokeObjectURL(urlToRevoke);
        } catch (cleanupError) {
          console.warn("Impossible de libérer l'URL audio", cleanupError);
        }
        audioObjectUrlsRef.current.delete(urlToRevoke);
      }

      if (finalAudioUrl) {
        audioObjectUrlsRef.current.add(finalAudioUrl);
      }
    } catch (error) {
      console.error("Erreur lors de l'envoi du message", error);
      let erroredUrl = null;
      updateLastMessageInConversation(
        conversationIdForRequest,
        (current) => {
          if (current.audioUrl) {
            erroredUrl = current.audioUrl;
          }

          return {
            text: "⚠️ Erreur : impossible de contacter le serveur.",
            isStreaming: false,
            audioUrl: null,
            audioFormat: null,
            audioSampleRate: null,
          };
        }
      );

      if (erroredUrl && typeof window !== "undefined") {
        try {
          URL.revokeObjectURL(erroredUrl);
        } catch (cleanupError) {
          console.warn("Impossible de libérer l'URL audio", cleanupError);
        }
        audioObjectUrlsRef.current.delete(erroredUrl);
      }
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
              className={`voice-toggle-button${
                isVoiceReady ? " ready" : ""
              }${isVoiceActivating ? " activating" : ""}`}
              onClick={handleActivateVoice}
              aria-pressed={isVoiceReady}
              aria-label={
                isVoiceReady
                  ? "Lecture audio activée"
                  : "Activer la lecture audio"
              }
              disabled={isVoiceActivating}
            >
              {isVoiceActivating
                ? "⏳ Activation..."
                : isVoiceReady
                ? "🔊 Audio prêt"
                : "▶️ Activer la voix"}
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
          {voiceActivationError && (
            <div className="voice-activation-feedback" role="alert">
              {voiceActivationError}
            </div>
          )}
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
        </footer>
      </div>
    </div>
  );
}

export default App;
