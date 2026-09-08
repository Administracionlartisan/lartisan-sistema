"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AssistantRole, fallbackAnswers, matchAssistantTopic, topicsForRole } from "../data/assistantKnowledge";
import { DiagnosticContext, formatDiagnostic, runOperationDiagnostics } from "../data/operationDiagnostics";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; unknown?: boolean };
const API_BASE = "https://www.lartisantaller.com/sistema-api";
const roleNames: Record<AssistantRole, string> = {
  vendedora: "Vendedora",
  supervisora: "Supervisión",
  administracion: "Administración / Gerencia",
};
const suggestions: Record<AssistantRole, string[]> = {
  vendedora: ["¿Cómo registro una venta?", "¿Cómo envío solo una unidad de invitación?", "¿Cómo cierro mi turno?"],
  supervisora: ["¿Cómo elijo el local donde voy a trabajar?", "¿Cómo indico que falta un producto del pedido?", "¿Dónde veo los productos con stock bajo?"],
  administracion: ["¿Cómo creo un usuario y su clave temporal?", "¿Cómo sincronizo el P&L con Google Drive?", "¿Dónde reviso la salud del sistema?"],
};

export default function AiHelpChat({
  role, site, section, userName, diagnosticContext, onSupportCreated,
}: {
  role: AssistantRole; site: string; section: string; userName: string;
  diagnosticContext: Omit<DiagnosticContext, "browserOnline">;
  onSupportCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome", role: "assistant",
    content: `Hola ${userName.split(" ")[0]}. Soy la guía de L’ARTISAN. Puedo explicarte cómo usar el sistema, pero no realizo ni modifico operaciones.`,
  }]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const answerCursor = useRef<Record<string, number>>({});
  const fallbackCursor = useRef(0);
  const availableTopics = useMemo(() => topicsForRole(role), [role]);
  const groupedTopics = useMemo(() => {
    const grouped = new Map<string, typeof availableTopics>();
    for (const topic of availableTopics) grouped.set(topic.category, [...(grouped.get(topic.category) || []), topic]);
    return [...grouped.entries()];
  }, [availableTopics]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  const ask = async (text: string) => {
    const clean = text.trim();
    if (clean.length < 2 || sending) return;
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: "user", content: clean }]);
    setQuestion(""); setNotice(""); setShowCatalog(false); setSending(true);
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    const topic = matchAssistantTopic(clean, role);
    let content: string; let unknown = false;
    if (topic) {
      const cursor = answerCursor.current[topic.id] || 0;
      content = topic.answers[cursor % 3];
      answerCursor.current[topic.id] = cursor + 1;
    } else {
      content = fallbackAnswers[fallbackCursor.current % 3];
      fallbackCursor.current += 1; unknown = true;
    }
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", content, unknown }]);
    setSending(false);
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void ask(question); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(question); }
  };
  const diagnose = () => {
    const findings = runOperationDiagnostics({ ...diagnosticContext, browserOnline: navigator.onLine });
    setShowCatalog(false);
    setNotice("");
    setMessages((items) => [
      ...items,
      { id: crypto.randomUUID(), role: "user", content: "Revisá qué puede estar fallando en esta pantalla." },
      { id: crypto.randomUUID(), role: "assistant", content: formatDiagnostic(findings, diagnosticContext.section, diagnosticContext.site) },
    ]);
  };
  const lastQuestion = [...messages].reverse().find((message) => message.role === "user");
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.id !== "welcome");

  const escalate = async () => {
    if (!lastQuestion || escalating) return;
    setEscalating(true); setNotice("");
    try {
      const response = await fetch(`${API_BASE}/assistant/escalate`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: lastQuestion.content, site, section }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo enviar la consulta.");
      setNotice("Consulta enviada a Administración. Ya quedó en su bandeja de tareas.");
      onSupportCreated?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo enviar la consulta.");
    } finally { setEscalating(false); }
  };

  return (
    <div className="no-print fixed bottom-5 right-5 z-50">
      {open && (
        <section role="dialog" aria-modal="false" aria-label="Guía de ayuda de L’ARTISAN"
          className="absolute bottom-16 right-0 flex h-[min(680px,calc(100vh-6rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#183a67]/25 bg-[#fffdf8] shadow-2xl">
          <header className="flex items-center justify-between bg-[#183a67] px-4 py-3 text-white">
            <div><b>Ayuda L’ARTISAN</b><p className="text-xs text-white/75">Guía gratuita · {roleNames[role]} · solo consulta</p></div>
            <button onClick={() => setOpen(false)} aria-label="Cerrar ayuda" className="rounded px-3 py-2 text-xl leading-none hover:bg-white/10">×</button>
          </header>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border-b bg-white px-4 py-2">
            <button type="button" onClick={diagnose} className="rounded-full bg-[#eef3f8] px-3 py-2 text-xs font-black text-[#183a67] hover:bg-[#dfe9f3]">
              Revisar qué está fallando
            </button>
            <button type="button" onClick={() => setShowCatalog((value) => !value)}
              className="px-1 py-2 text-xs font-bold text-[#183a67] underline" aria-expanded={showCatalog}>
              {showCatalog ? "Ocultar preguntas" : `Ver ${availableTopics.length} preguntas`}
            </button>
          </div>
          {showCatalog ? (
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {groupedTopics.map(([category, topics]) => (
                <section key={category}>
                  <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-[#ec3a35]">{category}</h3>
                  <div className="space-y-2">{topics.map((topic) => (
                    <button key={topic.id} type="button" onClick={() => void ask(topic.question)}
                      className="block w-full rounded-xl border bg-white px-3 py-2 text-left text-sm hover:border-[#183a67] hover:bg-[#eef3f8]">
                      {topic.question}
                    </button>
                  ))}</div>
                </section>
              ))}
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
              {messages.map((message) => (
                <div key={message.id}
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "ml-auto bg-[#183a67] text-white" : message.unknown ? "border border-[#e7c26a] bg-[#fff5d8]" : "border bg-white"}`}>
                  {message.content}
                </div>
              ))}
              {sending && <div className="w-fit rounded-2xl border bg-white px-4 py-3 text-sm text-slate-500">Buscando en la guía…</div>}
            </div>
          )}
          {!showCatalog && messages.length === 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 pb-3">
              {suggestions[role].map((item) => <button key={item} onClick={() => void ask(item)}
                className="shrink-0 rounded-full border bg-white px-3 py-2 text-left text-xs font-bold hover:border-[#183a67]">{item}</button>)}
            </div>
          )}
          {!showCatalog && lastQuestion && lastAssistant && !notice && (
            <div className="border-t px-4 py-2 text-xs">¿No resolvió tu duda?{" "}
              <button onClick={escalate} disabled={escalating} className="font-bold underline disabled:opacity-50">
                {escalating ? "Enviando…" : "Enviar a Administración"}
              </button>
            </div>
          )}
          {notice && <p className="border-t bg-[#eef5ef] px-4 py-3 text-xs font-bold" role="status">{notice}</p>}
          <form onSubmit={submit} className="border-t bg-white p-3">
            <label className="sr-only" htmlFor="help-question">Escribí tu consulta</label>
            <div className="flex items-end gap-2">
              <textarea id="help-question" value={question} onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown} maxLength={500} rows={2} placeholder="Escribí tu consulta…"
                className="min-h-[48px] flex-1 resize-none rounded-xl border p-3 text-base" />
              <button type="submit" disabled={sending || question.trim().length < 2}
                className="rounded-xl bg-[#ec3a35] px-4 py-3 font-bold text-white disabled:opacity-40">Enviar</button>
            </div>
            <p className="mt-2 text-[12px] text-slate-500">No usa API ni consume tokens. No escribas contraseñas, códigos ni datos bancarios.</p>
          </form>
        </section>
      )}
      <button onClick={() => setOpen((value) => !value)} aria-expanded={open}
        aria-label={open ? "Cerrar ayuda" : "Abrir ayuda"}
        className="rounded-full bg-[#ec3a35] px-5 py-3 text-sm font-bold text-white shadow-lg">
        {open ? "Cerrar" : "✦ Ayuda"}
      </button>
    </div>
  );
}
