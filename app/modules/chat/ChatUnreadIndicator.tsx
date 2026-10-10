"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../shared/constants";

/** Persiste visible en toda la aplicación, incluso fuera de la pestaña Chat. */
export default function ChatUnreadIndicator({ onOpen, open = false }: { onOpen: () => void; open?: boolean }) {
  const [unread, setUnread] = useState(0);
  const previous = useRef(0);
  const preferences = useRef({ sound: true, desktop: false });
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    let enabled = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${API_BASE}/chat/threads`, { credentials: "include" });
        if (!response.ok) return;
        const data = await response.json() as { threads?: Array<{ unread?: number }> };
        const total = (data.threads ?? []).reduce((sum, thread) => sum + Number(thread.unread ?? 0), 0);
        if (enabled) {
          if (total > previous.current) {
            if (preferences.current.sound) try { const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (Ctx) { const context = audio.current ?? new Ctx(); audio.current = context; const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 760; gain.gain.setValueAtTime(0.035, context.currentTime); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.09); } } catch { /* El indicador visual siempre queda disponible. */ }
            if (preferences.current.desktop && "Notification" in window && Notification.permission === "granted") new Notification("L'ARTISAN · Chat interno", { body: "Tenés mensajes operativos nuevos." });
          }
          previous.current = total; setUnread(total);
        }
      } catch { /* La aplicación mantiene sus módulos operativos sin conexión. */ }
    };
    void fetch(`${API_BASE}/chat/bootstrap`, { credentials: "include" }).then(async response => response.ok ? response.json() : null).then((value: unknown) => { const data = value as { settings?: { sound?: boolean; desktop?: boolean } } | null; if (data?.settings) preferences.current = { sound: data.settings.sound !== false, desktop: data.settings.desktop === true }; }).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { enabled = false; window.clearInterval(timer); };
  }, []);
  return <button type="button" onClick={onOpen} className="relative inline-flex items-center gap-1.5 rounded-full bg-[#183a67] px-5 py-3 font-bold text-white shadow-lg shadow-[#183a67]/30 transition hover:-translate-y-px hover:bg-[#102f57] hover:shadow-xl" aria-label={open ? "Cerrar chat interno" : unread ? `Abrir chat, ${unread} mensajes sin leer` : "Abrir chat interno"} title={open ? "Cerrar chat" : "Abrir chat interno"}><span aria-hidden="true" className="text-base">◌</span> Chat{unread > 0 && <span className="rounded-full bg-[#ec3a35] px-1.5 py-0.5 text-xs text-white shadow-sm">{unread > 99 ? "99+" : unread}</span>}</button>;
}
