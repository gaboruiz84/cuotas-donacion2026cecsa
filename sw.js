const CACHE_NAME = 'cuotas-ceca-v11';

// Archivos estáticos que queremos guardar en el teléfono para que cargue rápido (y funcione offline la interfaz)
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/firebase-config.js',
  '/firebase-service.js',
  '/manifest.json',
  '/logo-192.png',
  '/logo-512.png'
];

// 1. EVENTO DE INSTALACIÓN: Guarda los archivos en el caché del navegador
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Archivos en caché guardados correctamente');
        return cache.addAll(urlsToCache);
      })
  );
  // Fuerza al Service Worker a activarse inmediatamente
  self.skipWaiting();
});

// 2. EVENTO FETCH: Intercepta las peticiones de red
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Excluir dominios de Firebase y Google APIs
  const excludedDomains = [
    'firebaseio.com',
    'googleapis.com',
    'gstatic.com',
    'firebaseapp.com',
    'web.app'
  ];

  const shouldExclude = excludedDomains.some(domain => 
    requestUrl.hostname.includes(domain)
  );

  if (shouldExclude) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Para el resto de archivos (HTML, JS, CSS, Imágenes), intenta usar la caché primero.
  // Si no está en caché, descárgalo de internet.
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Devuelve la versión guardada en el teléfono
        }
        return fetch(event.request); // Si no está, lo busca en internet
      })
  );
});

// 3. EVENTO ACTIVATE: Limpia cachés viejas si en el futuro cambias 'cuotas-ceca-v2'
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Borrando caché antigua', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Toma el control inmediato de la página
  self.clients.claim();
});
