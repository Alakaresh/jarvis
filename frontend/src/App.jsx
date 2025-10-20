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
    <div className="min-h-screen bg-gradient-to-b from-[#343541] via-[#2a2b32] to-[#171923] text-white flex flex-col">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-400/10 text-2xl text-emerald-400">
            🤖
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Jarvis</h1>
            <p className="text-sm text-white/60">
              Ton assistant conversationnel, inspiré de l&apos;interface ChatGPT.
            </p>
          </div>
        </div>
      </header>

      <main ref={chatRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 px-6 py-10">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-white/5 bg-white/5 p-8 text-center text-white/60 shadow-lg shadow-black/20">
              <h2 className="text-lg font-medium text-white/80">Commence une nouvelle conversation</h2>
              <p className="mt-2 text-sm">
                Pose une question à Jarvis et reçois une réponse immédiate. Inspire-toi du style ChatGPT pour explorer des idées !
              </p>
            </div>
          )}

          {messages.map((m, i) => {
            const isUser = m.sender === "user";
            return (
              <article
                key={i}
                className={`flex gap-4 rounded-2xl border border-white/5 bg-white/5 p-5 shadow-md shadow-black/10 ${
                  isUser ? "flex-row-reverse text-right" : ""
                }`}
              >
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg text-xl ${
                    isUser ? "bg-sky-400/10 text-sky-300" : "bg-emerald-400/10 text-emerald-300"
                  }`}
                >
                  {isUser ? "🙂" : "🤖"}
                </div>
                <div className={`flex flex-1 flex-col ${isUser ? "items-end" : ""}`}>
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/40">
                    {isUser ? "Vous" : "Jarvis"}
                  </span>
                  <p
                    className={`mt-2 w-full rounded-xl px-5 py-4 text-sm leading-relaxed shadow-inner ${
                      isUser
                        ? "bg-[#343541] text-white/90"
                        : "bg-[#444654] text-white"
                    }`}
                  >
                    {m.text}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-white/10 bg-gradient-to-t from-[#171923]/95 via-[#171923]/80 to-transparent px-4 py-8 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <div className="relative flex items-center gap-4 rounded-full border border-white/10 bg-[#23242b] px-6 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.45)] transition focus-within:border-white/20">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Poser une question"
              className="flex-1 bg-transparent text-base text-white placeholder-white/50 outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-gradient-to-b from-white/10 to-white/5 text-white/80 shadow-[0_6px_14px_rgba(0,0,0,0.35)] transition hover:text-white"
                aria-label="Activer le micro"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5"
                >
                  <path d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5Z" />
                  <path d="M5.75 11.75a.75.75 0 0 0-1.5 0 7.75 7.75 0 0 0 6.5 7.64v1.11H7.5a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-3.25v-1.11a7.75 7.75 0 0 0 6.5-7.64.75.75 0 0 0-1.5 0 6.25 6.25 0 0 1-12.5 0Z" />
                </svg>
              </button>
              <button
                onClick={sendMessage}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-[#ff6f3d] to-[#ff9158] text-white shadow-[0_8px_18px_rgba(255,111,61,0.35)] transition hover:from-[#ff824d] hover:to-[#ffa06f] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!input.trim()}
                aria-label="Envoyer"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.8"
                  stroke="currentColor"
                  className="h-5 w-5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-white/40">
            Jarvis peut se tromper. Vérifie les informations importantes.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
