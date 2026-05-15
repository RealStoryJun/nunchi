import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// PWA service worker 등록 (2026-05-16 PR 2). 홈 화면 설치 + 오프라인 진입 가능.
// production 빌드에서만 등록 (dev 환경에선 캐시가 HMR 막아 디버깅 불편).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] service worker 등록 실패 (오프라인 기능 비활성):', err);
    });
  });
}
