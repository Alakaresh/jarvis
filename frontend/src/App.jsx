import { useEffect, useRef, useState } from "react";
import "./App.css";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const chatRef = useRef(null);
  const fileInputRef = useRef(null);
  const MAX_ATTACHMENT_SIZE = 1_000_000; // 1 Mo

  const sendMessage = async () => {
    if (isSending || !input.trim()) return;

    const filesToSend = attachments;
    const userMsg = {
      sender: "user",
      text: input,
      files: filesToSend.map((file) => file.name),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    try {
      setIsSending(true);

      const encodedFiles = await Promise.all(
        filesToSend.map((file) =>
          new Promise((resolve, reject) => {
            if (file.size > MAX_ATTACHMENT_SIZE) {
              reject(
                new Error(
                  `Le fichier ${file.name} dépasse la taille maximale autorisée (1 Mo).`
                )
              );
              return;
            }

            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (typeof result !== "string") {
                reject(new Error(`Lecture impossible pour ${file.name}`));
                return;
              }

              const base64 = result.split(",").pop() || "";
              resolve({
                name: file.name,
                type: file.type || undefined,
                content: base64,
              });
            };
            reader.onerror = () => reject(new Error(`Lecture impossible pour ${file.name}`));
            reader.readAsDataURL(file);
          })
        )
      );

      const payload = {
        text: userMsg.text,
        files: encodedFiles.length > 0 ? encodedFiles : undefined,
      };

      const res = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || "Erreur inconnue du serveur");
      }

      const botMsg = { sender: "bot", text: data.response };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      const errMsg = {
        sender: "bot",
        text:
          err instanceof Error
            ? `⚠️ Erreur : ${err.message}`
            : "⚠️ Erreur : impossible de contacter le serveur.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setAttachments((prev) => [...prev, ...files]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
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
              <div>{m.text}</div>
              {m.files?.length > 0 && (
                <ul className="message-attachments">
                  {m.files.map((fileName, index) => (
                    <li key={`${fileName}-${index}`}>📎 {fileName}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </main>

      <footer className="input-bar">
        <div className="input-wrapper">
          {attachments.length > 0 && (
            <div className="attachment-preview">
              {attachments.map((file, index) => (
                <span key={`${file.name}-${index}`} className="attachment-chip">
                  📎 {file.name}
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => removeAttachment(index)}
                    aria-label={`Retirer ${file.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="input-controls">
            <label className="file-input" aria-label="Ajouter des fichiers">
              📎
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                disabled={isSending}
              />
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Écris ton message ici..."
              disabled={isSending}
            />
            <button
              type="button"
              className="send-button"
              onClick={sendMessage}
              disabled={isSending}
            >
              {isSending ? "Envoi..." : "Envoyer"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
