/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// ── Precache all build assets ─────────────────────────────────────────────────
// VitePWA injects the manifest here at build time.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Activate immediately — take control without waiting ──────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Web Push notifications ────────────────────────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  let title = 'Sow Now';
  let body  = 'Your daily growing advice is ready.';
  let url   = '/advice';

  if (event.data) {
    try {
      const payload = event.data.json() as {
        title?: string;
        body?: string;
        url?: string;
      };
      if (payload.title) title = payload.title;
      if (payload.body)  body  = payload.body;
      if (payload.url)   url   = payload.url;
    } catch {
      body = event.data.text() || body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data:  { url },
      tag:   'sow-now-advice',          // replaces any previous unread notification
    }),
  );
});

// ── Notification click — open or focus the app ────────────────────────────────
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const targetUrl: string = (event.notification.data as { url?: string })?.url ?? '/advice';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // If a window is already open, focus it and navigate
        for (const client of clients) {
          if ('focus' in client) {
            (client as WindowClient).focus();
            (client as WindowClient).navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(targetUrl);
      }),
  );
});
