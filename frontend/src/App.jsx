import { useState, useRef, useEffect } from "react";
import "./App.css";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const chatRef = useRef(null);
  const fileInputRef = useRef(null);

  const sendMessage = async () => {
    if (!input.trim() || isSending) return;

    const textToSend = input;
    const userMsg = { sender: "user", text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSend }),
      });

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
      setIsSending(false);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    setSelectedFile(file ?? null);
  };

  const uploadDocument = async () => {
    if (!selectedFile || isUploading) return;

    setIsUploading(true);

    try {
      const textContent = await selectedFile.text();
      if (!textContent.trim()) {
        throw new Error("Le document sélectionné est vide.");
      }

      const payload = {
        filename: selectedFile.name,
        content: textContent,
      };

      const res = await fetch("http://127.0.0.1:8000/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const detail = errorData.detail || "Impossible d'envoyer le document.";
        throw new Error(detail);
      }

      const data = await res.json();
      const confirmation = data?.message || "Document reçu !";
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: `📄 ${confirmation} (${data?.document ?? selectedFile.name})`,
        },
      ]);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "erreur inconnue";
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: `⚠️ Erreur lors de l'envoi du document : ${errorMessage}`,
        },
      ]);
    } finally {
      setIsUploading(false);
    }
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
            <div className="bubble">{m.text}</div>
          </div>
        ))}
      </main>

      <footer className="input-bar">
        <div className="input-wrapper">
          <label className="file-upload" title="Joindre un document texte">
            <span>📎</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.csv,.json,.log,.xml,.html"
              onChange={handleFileChange}
            />
          </label>
          <button
            className="upload-button"
            type="button"
            onClick={uploadDocument}
            disabled={!selectedFile || isUploading}
          >
            {isUploading ? "Envoi..." : "Envoyer le doc"}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Écris ton message ici..."
          />
          <button
            className="send-button"
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || isSending}
          >
            {isSending ? "Envoi..." : "Envoyer"}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default App;
