import { useState, useRef, useEffect } from "react";
import axios from "axios";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const chatRef = useRef(null);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const res = await axios.post("http://127.0.0.1:8000/chat", { text: input });
      const botMsg = { sender: "bot", text: res.data.response };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "⚠️ Erreur : impossible de contacter le serveur." },
      ]);
    }
  };

  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
  }, [messages]);

 return (
  <div className="flex flex-col min-h-screen bg-[#1e1f25] text-gray-100 relative">
    {/* Header */}
    <header className="py-3 text-center border-b border-gray-700 bg-[#22232b] text-lg font-semibold">
      🤖 Jarvis
    </header>

    {/* Zone de chat */}
    <main
      ref={chatRef}
      className="flex-1 overflow-y-auto p-6 space-y-4 scroll-smooth mb-32"
    >
      {messages.length === 0 && (
        <p className="text-center text-gray-500 italic mt-10">
          💬 Dis bonjour à Jarvis pour commencer !
        </p>
      )}

      {messages.map((m, i) => (
        <div
          key={i}
          className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[75%] px-4 py-2 rounded-2xl shadow-md ${
              m.sender === "user"
                ? "bg-blue-600 text-white rounded-br-none"
                : "bg-gray-700 text-gray-100 rounded-bl-none"
            }`}
          >
            {m.text}
          </div>
        </div>
      ))}
    </main>

    {/* Barre de saisie */}
    <footer className="fixed bottom-6 left-0 w-full flex justify-center z-10">
      <div className="flex items-center gap-3 w-[80%] max-w-2xl bg-gray-800/95 backdrop-blur-md border border-gray-700 rounded-full px-6 py-4 shadow-2xl">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Écris ton message ici..."
          className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none text-lg"
        />
        <button
          onClick={sendMessage}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full font-semibold transition-transform transform hover:scale-105"
        >
          Envoyer
        </button>
      </div>
    </footer>
  </div>
);

}

export default App;
