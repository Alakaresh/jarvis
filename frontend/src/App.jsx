import { useState, useRef, useEffect } from "react";
import "./App.css";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const chatRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);

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
              {m.text}
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
