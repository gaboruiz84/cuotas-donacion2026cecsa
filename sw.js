const CACHE_NAME = 'cuotas-ceca-v12';
const STATIC_CACHE = 'cuotas-static-v12';
const DYNAMIC_CACHE = 'cuotas-dynamic-v12';

// Archivos estáticos para cachear
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/firebase-config.js',
  '/firebase-service.js',
  '/manifest.json',
  '/logo-192.png',
  '/logo-512.png'
];

// Dominios de Firebase (no cachear)
const EXCLUDED_DOMAINS = [
  'firebaseio.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
  'web.app',
  'firestore.googleapis.com'
];

// 1. INSTALACIÓN - Cachear assets estáticos
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Cacheando assets estáticos');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 2. FETCH - Estrategia: Cache First para estáticos, Network First para API
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Excluir dominios de Firebase/Google
  if (EXCLUDED_DOMAINS.some(d => url.hostname.includes(d))) {
    return;
  }

  // Estrategia para peticiones de navegación (HTML)
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request)
        .then(cached => cached || fetch(request)
          .then(response => {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
            return response;
          })
        )
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Estrategia Cache First para assets estáticos
  if (STATIC_ASSETS.some(asset => url.pathname.endsWith(asset) || url.pathname === asset)) {
    event.respondWith(
      caches.match(request)
        .then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
            return response;
          });
        })
    );
    return;
  }

  // Estrategia Network First para todo lo demás
  event.respondWith(
    fetch(request)
      .then(response => {
        const clone = response.clone();
        caches.open(DYNAMIC_CACHE).then(cache => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// 3. ACTIVATION - Limpiar cachés viejos
self.addEventListener('activate', event => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Eliminando caché viejo:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// 4. BACKGROUND SYNC - Sincronizar pagos pendientes cuando vuelva la conexión
self.addEventListener('sync', event => {
  console.log('[SW] Evento de sincronización:', event.tag);
  
  if (event.tag === 'sync-payments') {
    event.waitUntil(syncPendingPayments());
  }
});

async function syncPendingPayments() {
  // Obtener pagos pendientes de IndexedDB
  const db = await openDB();
  const tx = db.transaction('pendingPayments', 'readwrite');
  const store = tx.objectStore('pendingPayments');
  const pending = await getAllFromStore(store);
  
  console.log(`[SW] Sincronizando ${pending.length} pagos pendientes`);
  
  for (const payment of pending) {
    try {
      // Aquí iría la lógica para enviar a Firestore
      console.log('[SW] Pago sincronizado:', payment);
      store.delete(payment.id);
    } catch (err) {
      console.error('[SW] Error sincronizando:', err);
    }
  }
}

// Helpers para IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cuotas-offline', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingPayments')) {
        db.createObjectStore('pendingPayments', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// 5. NOTIFICACIONES PUSH (preparado para futuro)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'Tienes actualizaciones en Cuotas CECSA',
    icon: '/logo-192.png',
    badge: '/logo-192.png',
    vibrate: [100, 50, 100],
    data: { url: '/' }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Cuotas CECSA', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
