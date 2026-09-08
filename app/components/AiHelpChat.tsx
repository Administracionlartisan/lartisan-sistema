"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type Role = "vendedora" | "supervisora" | "administracion";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  apiMessageId?: number;
  failed?: boolean;
};

const API_BASE = "https://www.lartisantaller.com/sistema-api";

const suggestionsByRole: Record<Role, string[]> = {
  vendedora: [
    "¿Cómo hago una invitación de un solo producto?",
    "¿Cómo cierro mi turno?",
    "¿Qué hago si se corta Internet?",
  ],
  supervisora: [
    "¿Cómo cambio el local donde voy a vender?",
    "¿Cómo informo un faltante en un pedido?",
    "¿Dónde reviso el stock bajo?",
  ],
  administracion: [
    "¿Cómo genero una contraseña temporal?",
    "¿Cómo actualizo el P&L desde Drive?",
    "¿Dónde reviso la salud del sistema?",
  ],
};

export default function AiHelpChat({
  role,
  site,
  section,
  userName,
  onSupportCreated,
}: {
  role: Role;
  site: string;
  section: string;
  userName: string;
  onSupportCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Hola ${userName.split(" ")[0]}. Soy la ayuda de L’ARTISAN. Puedo explicarte cómo usar el sistema, pero no realizo operaciones por vos.`,
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  const ask = async (text: string) => {
    const clean = text.trim();
    if (clean.length < 2 || sending) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: clean,
    };
    const previous = messages.filter((message) => message.id !== "welcome").slice(-6);
    setMessages((items) => [...items, userMessage]);
    setQuestion("");
    setNotice("");
    setSending(true);
    try {
      const response = await fetch(`${API_BASE}/assistant/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: clean,
          site,
          section,
          history: previous.map(({ role: messageRole, content }) => ({ role: messageRole, content })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || "No pude responder ahora."), { messageId: data.messageId });
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer,
          apiMessageId: data.messageId,
        },
      ]);
    } catch (error) {
      const failure = error as Error & { messageId?: number };
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: failure.message || "No pude responder ahora. Podés enviar la consulta a Administración.",
          apiMessageId: failure.messageId,
          failed: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(question);
    }
  };

  const lastQuestion = [...messages].reverse().find((message) => message.role === "user");
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.id !== "welcome");

  const escalate = async () => {
    if (!lastQuestion || escalating) return;
    setEscalating(true);
    setNotice("");
    try {
      const response = await fetch(`${API_BASE}/assistant/escalate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: lastQuestion.content,
          messageId: lastAssistant?.apiMessageId,
          site,
          section,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo enviar la consulta.");
      setNotice("Consulta enviada a Administración. Ya quedó en su bandeja de tareas.");
      onSupportCreated?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo enviar la consulta.");
    } finally {
      setEscalating(false);
    }
  };

  return (
    <div className="no-print fixed bottom-5 right-5 z-50">
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="Ayuda con inteligencia artificial"
          className="absolute bottom-16 right-0 flex h-[min(650px,calc(100vh-6rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#183a67]/25 bg-[#fffdf8] shadow-2xl"
        >
          <header className="flex items-center justify-between bg-[#183a67] px-4 py-3 text-white">
            <div>
              <b>Ayuda con IA</b>
              <p className="text-xs text-white/75">Consulta · no realiza operaciones</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Cerrar ayuda" className="rounded px-3 py-2 text-xl leading-none hover:bg-white/10">×</button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "ml-auto bg-[#183a67] text-white" : message.failed ? "border border-[#e7c26a] bg-[#fff5d8]" : "border bg-white"}`}
              >
                {message.content}
              </div>
            ))}
            {sending && <div className="w-fit rounded-2xl border bg-white px-4 py-3 text-sm text-slate-500">Consultando…</div>}
          </div>

          {messages.length === 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 pb-3">
              {suggestionsByRole[role].map((suggestion) => (
                <button key={suggestion} onClick={() => void ask(suggestion)} className="shrink-0 rounded-full border bg-white px-3 py-2 text-left text-xs font-bold hover:border-[#183a67]">
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {lastQuestion && lastAssistant && !notice && (
            <div className="border-t px-4 py-2 text-xs">
              ¿No resolvió tu duda?{" "}
              <button onClick={escalate} disabled={escalating} className="font-bold underline disabled:opacity-50">
                {escalating ? "Enviando…" : "Enviar a Administración"}
              </button>
            </div>
          )}
          {notice && <p className="border-t bg-[#eef5ef] px-4 py-3 text-xs font-bold" role="status">{notice}</p>}

          <form onSubmit={submit} className="border-t bg-white p-3">
            <label className="sr-only" htmlFor="ai-help-question">Escribí tu consulta</label>
            <div className="flex items-end gap-2">
              <textarea
                id="ai-help-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={1200}
                rows={2}
                placeholder="Escribí tu consulta…"
                className="min-h-[48px] flex-1 resize-none rounded-xl border p-3 text-base"
              />
              <button type="submit" disabled={sending || question.trim().length < 2} className="rounded-xl bg-[#ec3a35] px-4 py-3 font-bold text-white disabled:opacity-40">Enviar</button>
            </div>
            <p className="mt-2 text-[12px] text-slate-500">No escribas contraseñas, códigos ni datos bancarios.</p>
          </form>
        </section>
      )}
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Cerrar ayuda con IA" : "Abrir ayuda con IA"}
        className="rounded-full bg-[#ec3a35] px-5 py-3 text-sm font-bold text-white shadow-lg"
      >
        {open ? "Cerrar" : "✦ Ayuda IA"}
      </button>
    </div>
  );
}
