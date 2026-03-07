const CACHE_NAME = 'cuotas-app-v1';

// Archivos que queremos guardar en el teléfono para que cargue rápido
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json'
];

// Evento de instalación: Guarda los archivos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Archivos en caché guardados');
        return cache.addAll(urlsToCache);
      })
  );
});

// Evento fetch: Intercepta las peticiones de red
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // ¡MUY IMPORTANTE! Si la petición va hacia Google Apps Script,
  // NUNCA uses la caché. Queremos los datos en vivo.
  if (requestUrl.hostname.includes('script.google.com') || requestUrl.hostname.includes('script.googleusercontent.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Para todo lo demás (HTML, JS, CSS, Imágenes), intenta usar la caché primero
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Devuelve la versión en caché si existe, sino, descárgala de internet
        return response || fetch(event.request);
      })
  );
});

// Evento activate: Limpia cachés viejas si actualizamos la versión
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
