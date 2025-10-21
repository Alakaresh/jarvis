import { useState, useRef, useEffect } from "react";
import "./App.css";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState(null);
  const chatRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);
  const copyTimeoutRef = useRef(null);

  const renderMessageContent = (text) => {
    if (!text) return null;

    const normaliseNewlines = (value) => value.replace(/\r\n/g, "\n");
    const codeBlockRegex = /```([^\n\r]*)\r?\n?([\s\S]*?)```/g;

    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const plainText = text.slice(lastIndex, match.index);
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

    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex);
      segments.push({ type: "text", content: normaliseNewlines(remainingText) });
    }

    const visibleSegments = segments.filter((segment) => {
      if (segment.type === "code") {
        return segment.content.trim() !== "";
      }

      return segment.content.trim() !== "";
    });

    if (visibleSegments.length === 0) {
      return null;
    }

    return (
      <div className="message-content">
        {visibleSegments.map((segment, index) => {
          if (segment.type === "code") {
            return (
              <pre
                key={`code-${index}`}
                className="message-code-block"
                data-language={segment.language || undefined}
              >
                <code>{segment.content}</code>
              </pre>
            );
          }

          return (
            <p key={`text-${index}`} className="message-text">
              {segment.content}
            </p>
          );
        })}
      </div>
    );
  };

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

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

  const handleCopyMessage = async (text, index) => {
    const didCopy = await copyTextToClipboard(text);

    if (!didCopy) {
      return;
    }

    setCopiedMessageIndex(index);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = setTimeout(() => {
      setCopiedMessageIndex(null);
    }, 2000);
  };

  const sendMessage = async () => {
    if (isLoading) return;
    if (!input.trim() && selectedFiles.length === 0) return;

    const messageText = input;
    const filesToSend = selectedFiles;
    const attachmentSummaries = filesToSend.map((file) => ({
      name: file.name,
      type: file.type,
    }));

    const userMsg = { sender: "user", text: messageText, attachments: attachmentSummaries };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSelectedFiles([]);
    fileInputRef.current && (fileInputRef.current.value = "");

    try {
      setIsLoading(true);

      const formData = new FormData();
      formData.append("text", messageText);
      filesToSend.forEach((file) => {
        formData.append("files", file);
      });

      const res = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Erreur serveur (${res.status})`);
      }

      const data = await res.json();
      const botMsg = { sender: "bot", text: data.response };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      const errMsg = {
        sender: "bot",
        text: "⚠️ Erreur : impossible de contacter le serveur.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
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
  }, [messages]);

  return (
    <div className="app-container">
      <header className="app-header">🤖 Jarvis</header>

      <main ref={chatRef} className="chat-container">
        {messages.length === 0 && (
          <p className="empty-message">💬 Dis bonjour à Jarvis pour commencer</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`message ${m.sender === "user" ? "user" : "bot"}`}
          >
            <div className="bubble">
              {m.sender === "bot" && m.text?.trim() && (
                <div className="message-toolbar">
                  <button
                    type="button"
                    className={`copy-button ${
                      copiedMessageIndex === i ? "copied" : ""
                    }`}
                    onClick={() => handleCopyMessage(m.text, i)}
                    aria-label="Copier la réponse"
                  >
                    {copiedMessageIndex === i ? "✅ Copié !" : "📋 Copier"}
                  </button>
                </div>
              )}
              {renderMessageContent(m.text)}
              {m.attachments?.length > 0 && (
                <ul className="attachment-list">
                  {m.attachments.map((file, idx) => (
                    <li key={`${file.name}-${idx}`} className="attachment-pill">
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
          className={`input-wrapper ${isDragging ? "dragging" : ""}`}
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
          />
        </div>
        {selectedFiles.length > 0 && (
          <div className="pending-attachments">
            {selectedFiles.map((file, index) => (
              <span key={`${file.name}-${file.lastModified}-${index}`} className="attachment-pill pending">
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
  );
}

export default App;
