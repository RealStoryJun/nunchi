// 매 build 시 dist/client/sw.js 의 CACHE_NAME 에 빌드 ID 주입.
// 효과: 새 deploy 가 PWA 의 activate 단계에서 옛 캐시(이름이 다른) 모두 삭제 → stale chunk 회피.
// vite plugin 으로 깊게 통합하지 않고 build 후 후처리만. 의존성 0, 운영 단순.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const swPath = path.resolve('dist/client/sw.js');
if (!fs.existsSync(swPath)) {
  console.warn('[sw-cache-bump] dist/client/sw.js 없음, skip (vite build 후 실행해야)');
  process.exit(0);
}

// 빌드 ID: 최근 git 커밋 short hash (사장님 패턴 - 커밋과 1:1 매핑). git 없으면 timestamp fallback.
let buildId;
try {
  buildId = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {
  buildId = Date.now().toString(36);
}

let content = fs.readFileSync(swPath, 'utf-8');
const next = `const CACHE_NAME = 'nunchi-${buildId}'`;
const re = /const CACHE_NAME = ['"]nunchi-[^'"]+['"]/;
if (!re.test(content)) {
  console.error('[sw-cache-bump] sw.js 의 CACHE_NAME 패턴 못 찾음. 형식 변경됐는지 확인.');
  process.exit(1);
}
content = content.replace(re, next);
fs.writeFileSync(swPath, content);
console.log(`[sw-cache-bump] CACHE_NAME → nunchi-${buildId}`);
