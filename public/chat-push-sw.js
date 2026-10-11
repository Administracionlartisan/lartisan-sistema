/* L'ARTISAN · notificaciones del Chat Interno.
   No contiene datos de conversaciones: el aviso es deliberadamente genérico. */
self.addEventListener("push", (event) => {
  const options = {
    body: "Tenés mensajes operativos nuevos. Abrí el Chat Interno para verlos.",
    icon: "/icons/lartisan-192.png",
    badge: "/icons/lartisan-32.png",
    tag: "lartisan-internal-chat",
    renotify: true,
    data: { url: "/" },
  };
  event.waitUntil(self.registration.showNotification("L'ARTISAN · Chat interno", options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((item) => new URL(item.url).origin === self.location.origin);
    return existing ? existing.focus() : clients.openWindow("/");
  }));
});
