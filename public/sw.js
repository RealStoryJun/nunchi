// 눈치 PWA service worker (2026-05-16 PR 2).
// 전략:
// - precache: app shell (index.html) 만. JS/CSS는 Vite hash 파일이라 런타임 캐시.
// - navigation 요청: network-first, fallback to cached shell (오프라인 진입 가능).
// - 정적 asset: cache-first (이미지·폰트·아이콘).
// - /api/* 는 캐시 X (live data, 인증 토큰 흐름 깨지 않음).

const CACHE_NAME = 'nunchi-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icon.png', '/favicon.svg', '/og.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // allSettled: 한 파일 404로 install 통째로 실패 막음 (og.png CDN race 등)
      Promise.allSettled(APP_SHELL.map((u) => cache.add(u))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // GET 만 캐시 (POST/PUT/DELETE는 무조건 network)
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // 외부 origin 은 패스 (브라우저 기본 처리, 인증 흐름 깨지지 않음)
  if (url.origin !== self.location.origin) return;
  // /api/* 는 캐시 X (live data, 세션 쿠키 그대로 흐름)
  if (url.pathname.startsWith('/api/')) return;

  // navigation 요청 (HTML): network-first, 실패 시 cached shell, 그래도 없으면 synthetic offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // 정상 응답이면 shell 캐시 갱신
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          // 캐시도 비었으면 synthetic offline 응답 (undefined 반환 막음, install 실패 케이스 대응)
          return (
            cached ||
            new Response(
              '<!doctype html><meta charset="utf-8"><title>오프라인</title><body style="font-family:system-ui;padding:2rem;background:#F5F2EA;color:#1A1A1A"><h1>오프라인이에요</h1><p>인터넷이 끊겨서 화면을 못 불러왔어요. 연결되면 새로고침해주세요.</p></body>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            )
          );
        }),
    );
    return;
  }

  // /assets/*는 Vite hash 파일. 새 deploy = 새 파일이라 cache hit 자연 발생.
  // 단 옛 hash 파일이 router state로 요청되면 stale 위험 → network-first + 실패 시 cache fallback.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((m) => m || Response.error())),
    );
    return;
  }

  // 그 외 정적 asset (이미지·폰트·아이콘): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        // 200 OK 만 캐시
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        }
        return res;
      });
    }),
  );
});

// 푸시 알림은 PR 3 에서 추가. 지금은 install + offline shell 만.
