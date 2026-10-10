// 그림책 3D 뷰어 — 책장(표지 목록) → 책을 누르면 앞으로 나와 펼쳐짐 → 쪽을 눌러 한 장씩 넘김 → 글이 있는 쪽은 자동 낭독
import * as THREE from '../vendor/three.module.js';

// 사용자 요청(2026-10-10 수정): 오른쪽(아래 귀퉁이)을 누르면 다음 장, 왼쪽을 누르면 앞 장
const CONFIG = {
  leftClick: 'prev',
  rightClick: 'next',
  curl: { r: 0.11, rHover: 0.19, R: 0.032, hoverZone: 0.24 },   // 귀퉁이 들림: 크기·호버 크기·말림 반지름·호버 판정 거리
  flipMs: 950,
  autoTurnDelay: 1400,
  readDelay: 250,            // 넘김이 끝난 뒤 낭독 시작까지
};

const W = 1;                 // 쪽 너비 (높이는 책의 aspect 로)
const G = 0.0032;            // 낱장 사이 간격
const T = 0.024;             // 표지 판 두께
const SEGX = 48, SEGY = 48;  // 넘김 휨·귀퉁이 말림용 분할 수
const TILTS = { front: 0, desk: -0.5 };   // 보기 모드: 정면 / 눕혀 보기(책상 위)
const BAR_PX = 150;          // 하단 플레이어가 가리는 높이

const $ = (s) => document.querySelector(s);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ 렌더러
const canvas = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
scene.add(new THREE.HemisphereLight(0xfffaf0, 0xc9ab84, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(-1.2, 2.2, 3.5);
scene.add(sun);

const loader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function loadTex(url) {
  return new Promise((res) => loader.load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    res(t);
  }, undefined, () => res(null)));
}
function mirrored(tex) {   // 뒷면은 좌우가 뒤집혀 보이므로 텍스처를 거울상으로
  const t = tex.clone();
  t.repeat.set(-1, 1);
  t.offset.set(1, 0);
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ 트윈
const tweens = new Set();
function tween(ms, fn, ease = easeInOut) {
  return new Promise((res) => tweens.add({ t0: performance.now(), ms, fn, ease, res }));
}
function tickTweens(now) {
  for (const tw of tweens) {
    const p = Math.min(1, (now - tw.t0) / tw.ms);
    tw.fn(tw.ease(p));
    if (p >= 1) { tweens.delete(tw); tw.res(); }
  }
}

// ------------------------------------------------------------------ 그림자 텍스처
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.scale(1, 0.5);                         // 원을 납작하게 → 캔버스 안에서 완전히 사라지는 타원
  const grd = g.createRadialGradient(128, 128, 20, 128, 128, 126);
  grd.addColorStop(0, 'rgba(60,35,10,.42)');
  grd.addColorStop(0.6, 'rgba(60,35,10,.18)');
  grd.addColorStop(1, 'rgba(60,35,10,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
})();

// ================================================================== 책
class Book {
  constructor(meta, index) {
    this.meta = meta;
    this.index = index;
    this.base = `books/${meta.id}/`;
    this.H = W / (meta.aspect || 1);
    this.N = Math.ceil(meta.pageCount / 2);   // 낱장 수 (앞뒤 2쪽)
    this.k = 0;                               // 넘긴 낱장 수 = 상태 번호
    this.open = 0;                            // 0 책장 ↔ 1 읽기
    this.away = 0;                            // 다른 책이 열릴 때 아래로 비켜남
    this.hover = 0;
    this.hoverTarget = 0;
    this.loaded = false;
    this.root = new THREE.Group();
    this.inner = new THREE.Group();
    this.root.add(this.inner);
    this.build();
  }

  zR(i) { return i === 0 ? this.N * G + T / 2 : (this.N - i) * G; }   // 오른쪽(안 넘긴) 자리
  zL(i) { return i === 0 ? -T / 2 : i * G; }                          // 왼쪽(넘긴) 자리

  build() {
    const { H, N } = this;
    const cloth = new THREE.MeshLambertMaterial({ color: 0x8e3d22 });
    const endpaper = new THREE.MeshLambertMaterial({ color: 0xf0e0c0 });
    const edge = new THREE.MeshLambertMaterial({ color: 0xf6eedc });
    this.paper = new THREE.MeshLambertMaterial({ color: 0xfbf5e8 });

    // 뒤표지 판
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), [cloth, cloth, cloth, cloth, endpaper, cloth]);
    back.position.set(W / 2, 0, -T / 2);
    this.inner.add(back);

    // 종이 묶음 두께 (오른쪽·왼쪽) — 높이는 updateBlocks 에서 scale.z 로
    const blockGeo = new THREE.BoxGeometry(W * 0.985, H * 0.985, 1);
    blockGeo.translate(0, 0, 0.5);
    this.blockR = new THREE.Mesh(blockGeo, edge);
    this.blockR.position.set(W / 2, 0, 0.0004);
    this.blockL = new THREE.Mesh(blockGeo, edge);
    this.blockL.position.set(-W / 2, 0, 0.0004);
    this.inner.add(this.blockR, this.blockL);

    // 바닥 그림자 (읽기 모드)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.6, H * 1.5),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 }));
    this.shadow.position.z = -T - 0.01;
    this.shadow.raycast = () => {};   // 클릭 판정에서 제외
    this.inner.add(this.shadow);

    this.leaves = [];
    for (let i = 0; i < N; i++) {
      const pivot = new THREE.Group();
      const leaf = { i, pivot, side: 'R', token: 0 };
      if (i === 0) {
        // 앞표지: 휘지 않는 판. 바깥 = 1쪽(표지), 안쪽 = 2쪽
        const geo = new THREE.PlaneGeometry(W, H);
        geo.translate(W / 2, 0, 0);
        leaf.front = new THREE.Mesh(geo, this.paper);
        leaf.front.position.z = T / 2 + 0.0005;
        leaf.back = new THREE.Mesh(geo, this.paper.clone());
        leaf.back.material.side = THREE.BackSide;
        leaf.back.position.z = -T / 2 - 0.0005;
        const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), cloth);
        board.position.x = W / 2;
        pivot.add(board, leaf.front, leaf.back);
        leaf.rigid = true;
      } else {
        const geo = new THREE.PlaneGeometry(W, H, SEGX, SEGY);
        geo.translate(W / 2, 0, 0);
        leaf.geo = geo;
        leaf.restY = Float32Array.from({ length: geo.attributes.position.count }, (_, n) => geo.attributes.position.getY(n));
        leaf.curl = 0;
        leaf.front = new THREE.Mesh(geo, this.paper);
        leaf.back = new THREE.Mesh(geo, this.paper.clone());
        leaf.back.material.side = THREE.BackSide;
        pivot.add(leaf.front, leaf.back);
      }
      pivot.position.z = this.zR(i);
      this.inner.add(pivot);
      this.leaves.push(leaf);
    }
    this.inner.position.x = this.innerTarget();
    this.updateBlocks();
  }

  async loadCover() {
    const t = await loadTex(this.meta.cover);
    if (t) this.leaves[0].front.material = new THREE.MeshLambertMaterial({ map: t });
  }

  async load(onProgress) {
    if (this.loaded) return;
    const res = await fetch(this.base + 'book.json', { cache: 'no-cache' });
    this.data = await res.json();
    let done = 0;
    await Promise.all(this.data.pages.map(async (src, n) => {
      const tex = await loadTex(this.base + src);
      onProgress?.(++done, this.data.pages.length);
      if (!tex) return;
      const p = n + 1;                       // 1부터
      const leaf = this.leaves[Math.floor((p - 1) / 2)];
      if (p % 2) leaf.front.material = new THREE.MeshLambertMaterial({ map: tex });
      else leaf.back.material = new THREE.MeshLambertMaterial({ map: mirrored(tex), side: THREE.BackSide });
    }));
    this.loaded = true;
  }

  innerTarget() {
    if (this.k === 0) return -W / 2;          // 닫힌 책: 표지가 가운데
    if (this.k === this.N) return W / 2;      // 마지막: 왼쪽 쪽이 가운데
    return 0;
  }

  updateBlocks() {
    // 움직이지 않는 낱장만 세서 종이 묶음 높이를 맞춘다 (앞표지 제외)
    let topR = 0, topL = 0;
    for (const l of this.leaves) {
      if (l.i === 0 || l.side === 'moving') continue;
      if (l.side === 'R') topR = Math.max(topR, this.zR(l.i));
      else topL = Math.max(topL, this.zL(l.i));
    }
    this.blockR.scale.z = Math.max(0.0001, topR - G * 0.6);
    this.blockL.scale.z = Math.max(0.0001, topL - G * 0.6);
    this.blockL.visible = topL > 0;
  }

  shape(leaf, c, curl = 0) {
    // c: 넘길 때 바깥쪽이 뒤처지는 휨(라디안). 열마다 각도를 조금씩 더해 이어 붙인다
    // curl: 바깥 아래 귀퉁이를 원통에 감듯 말아 올리는 크기 (접힘선까지 거리)
    const pos = leaf.geo.attributes.position;
    const cols = SEGX + 1, step = W / SEGX;
    const xs = new Float32Array(cols), zs = new Float32Array(cols);
    let x = 0, z = 0;
    for (let s = 1; s < cols; s++) {
      const a = c * ((s - 0.5) / SEGX) ** 1.3;
      x += step * Math.cos(a);
      z -= step * Math.sin(a);
      xs[s] = x; zs[s] = z;
    }
    const { R } = CONFIG.curl;
    const cx = W, cy = -this.H / 2, nx = Math.SQRT1_2, ny = -Math.SQRT1_2;   // 귀퉁이와 그쪽 방향
    const up = leaf.side === 'L' ? -1 : 1;    // 넘긴 낱장은 뒤집혀 있어 로컬 z 가 반대
    for (let n = 0; n < pos.count; n++) {
      const col = n % cols;
      let px = xs[col], py = leaf.restY[n], pz = zs[col];
      if (curl > 0) {
        const d = (cx - px) * nx + (cy - py) * ny;     // 귀퉁이까지 거리 (대각선 방향)
        const sPast = curl - d;                          // 접힘선을 넘어선 거리
        if (sPast > 0) {
          const th = sPast / R;
          const back = sPast - R * Math.sin(th);
          px -= nx * back; py -= ny * back;
          pz += up * R * (1 - Math.cos(th));
        }
      }
      pos.setXYZ(n, px, py, pz);
    }
    pos.needsUpdate = true;
    leaf.geo.computeVertexNormals();
  }

  updateCurls(t, reading) {
    // 양쪽 맨 위 낱장의 바깥 아래 귀퉁이를 살짝 들어 '넘길 수 있음'을 보여 준다 (앞표지 판은 제외)
    const { r, rHover } = CONFIG.curl;
    const tops = { R: this.k >= 1 && this.k < this.N ? this.k : -1, L: this.k - 1 >= 1 ? this.k - 1 : -1 };
    for (const leaf of this.leaves) {
      if (leaf.rigid) continue;
      const side = leaf.i === tops.R ? 'R' : leaf.i === tops.L ? 'L' : null;
      const atRest = leaf.side === side;
      let target = 0;
      if (reading && side && atRest) target = this.hoverCorner === side ? rHover : r + 0.012 * Math.sin(t * 0.0022 + (side === 'L' ? 1.6 : 0));
      if (leaf.side === 'moving') { leaf.curl = 0; continue; }
      const next = lerp(leaf.curl, target, 0.14);
      if (Math.abs(next - leaf.curl) < 1e-5 && target === 0 && leaf.curl === 0) continue;
      leaf.curl = next < 0.001 && target === 0 ? 0 : next;
      this.shape(leaf, 0, leaf.curl);
    }
  }

  flip(dir, ms = CONFIG.flipMs) {
    if ((dir > 0 && this.k >= this.N) || (dir < 0 && this.k <= 0)) return null;
    const i = dir > 0 ? this.k : this.k - 1;
    this.k += dir;
    const leaf = this.leaves[i];
    const token = ++leaf.token;
    const r0 = leaf.pivot.rotation.y, r1 = dir > 0 ? -Math.PI : 0;
    const z0 = leaf.pivot.position.z, z1 = dir > 0 ? this.zL(i) : this.zR(i);
    leaf.side = 'moving';
    this.updateBlocks();
    const x0 = this.inner.position.x, x1 = this.innerTarget();
    tween(ms + 150, (e) => { this.inner.position.x = lerp(x0, x1, e); });
    return tween(ms, (e) => {
      if (leaf.token !== token) return;
      leaf.pivot.rotation.y = lerp(r0, r1, e);
      leaf.pivot.position.z = lerp(z0, z1, e) + Math.sin(Math.PI * e) * 0.03;
      if (!leaf.rigid) this.shape(leaf, dir * 1.25 * Math.sin(Math.PI * e));
    }).then(() => {
      if (leaf.token !== token) return;
      if (!leaf.rigid) { leaf.curl = 0; this.shape(leaf, 0); }
      leaf.side = dir > 0 ? 'L' : 'R';
      this.updateBlocks();
    });
  }

  state() { return this.data?.states?.[this.k]; }
}

// ================================================================== 장면 구성
const books = [];
let active = null;
let mode = 'shelf';          // shelf | opening | reading | closing
const shelfCam = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const readCam = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
let plank;

function shelfPose(b) {
  const n = books.length, gap = 1.5;
  return { x: (b.index - (n - 1) / 2) * gap, y: 0.05 * b.hover - 1.6 * b.away, z: 0.12 * b.hover,
           rx: 0, ry: 0.32 * (1 - b.hover), s: 0.7 };
}
const readPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, s: 1 };
let viewMode = 'front';
try { if (localStorage.getItem('bw.view') === 'desk') viewMode = 'desk'; } catch { /* 기본 정면 */ }
const view = { tilt: TILTS[viewMode] };

function applyPose(b) {
  readPose.rx = view.tilt;
  const a = shelfPose(b), r = readPose, t = b.open;
  b.root.position.set(lerp(a.x, r.x, t), lerp(a.y, r.y, t), lerp(a.z, r.z, t));
  b.root.rotation.set(lerp(a.rx, r.rx, t), lerp(a.ry, r.ry, t), 0);
  b.root.scale.setScalar(lerp(a.s, r.s, t));
  b.shadow.material.opacity = t;
  const closed = b.k === 0, last = b.k === b.N;
  b.shadow.position.x = closed ? W / 2 : last ? -W / 2 : 0;
  b.shadow.scale.x = closed || last ? 0.55 : 1;
}

function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;

  // 책장: 모든 책 + 여백이 들어오게
  const n = Math.max(books.length, 1);
  const H = books[0]?.H || 1;
  const shelfW = (n - 1) * 1.5 + 1.4;
  const dShelf = Math.max(shelfW * 1.25 / 2 / tanH, (H * 2.0) / 2 / tanV);
  shelfCam.pos.set(0, 0.12, dShelf);
  shelfCam.look.set(0, -0.02, 0);
  if (plank) {
    plank.scale.x = Math.max(shelfW + 0.6, 2.4);
  }

  updateReadCam();
}

function updateReadCam() {
  // 읽기: 펼친 두 쪽 + 여백, 하단 플레이어를 피해 위로. 정면 보기는 화면에 꽉 차게, 눕혀 보기는 넉넉하게
  const h = window.innerHeight;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  const H = books[0]?.H || 1;
  const m = Math.min(1, view.tilt / TILTS.desk);          // 0 정면 → 1 눕힘
  const frac = Math.max(0.45, (h - BAR_PX - 20) / h);
  const dW = (2 * W * lerp(1.1, 1.4, m)) / 2 / tanH;
  const dH = (H * Math.cos(view.tilt) * lerp(1.08, 1.3, m)) / 2 / (tanV * frac);
  const d = Math.max(dW, dH);
  const shift = (BAR_PX / 2 / h) * 2 * d * tanV;
  readCam.pos.set(0, -shift, d);
  readCam.look.set(0, -shift, 0);
}

function updateCamera() {
  const t = active ? active.open : 0;
  updateReadCam();
  camera.position.lerpVectors(shelfCam.pos, readCam.pos, t);
  const look = new THREE.Vector3().lerpVectors(shelfCam.look, readCam.look, t);
  camera.lookAt(look);
}

// ------------------------------------------------------------------ 책 이름표
const labelsEl = $('#labels');
function updateLabels() {
  for (const b of books) {
    const p = new THREE.Vector3(b.root.position.x, plank.position.y - 0.05, 0.3);
    p.project(camera);
    b.label.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
    b.label.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
  }
}

// ================================================================== 오디오·플레이어
const audio = $('#voice');
const ui = {
  player: $('#player'), label: $('#pg-label'), count: $('#pg-count'),
  play: $('#btn-play'), prev: $('#btn-prev'), next: $('#btn-next'), first: $('#btn-first'), shelf: $('#btn-shelf'),
  seek: $('#seek'), cur: $('#t-cur'), dur: $('#t-dur'),
  view: $('#btn-view'), optRead: $('#opt-read'), optTurn: $('#opt-turn'), hint: $('#hint'), loading: $('#loading'),
};
let readTimer = 0, turnTimer = 0, audioKey = '';

try {
  ui.optRead.checked = localStorage.getItem('bw.autoRead') !== '0';
  ui.optTurn.checked = localStorage.getItem('bw.autoTurn') === '1';
} catch { /* 저장소를 못 쓰면 기본값 */ }
ui.optRead.addEventListener('change', () => { try { localStorage.setItem('bw.autoRead', ui.optRead.checked ? '1' : '0'); } catch {} });
ui.optTurn.addEventListener('change', () => { try { localStorage.setItem('bw.autoTurn', ui.optTurn.checked ? '1' : '0'); } catch {} });

const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

function stopAudio() {
  clearTimeout(readTimer);
  clearTimeout(turnTimer);
  audio.pause();
  ui.play.classList.remove('playing');
}

function playCurrent() {
  const st = active?.state();
  if (!st?.audio) { stopAudio(); return; }
  const key = `${active.meta.id}:${active.k}`;
  if (audioKey !== key) {
    audioKey = key;
    audio.src = active.base + st.audio;
  }
  audio.play().then(() => ui.play.classList.add('playing')).catch(() => ui.play.classList.remove('playing'));
}

audio.addEventListener('play', () => ui.play.classList.add('playing'));
audio.addEventListener('pause', () => ui.play.classList.remove('playing'));
audio.addEventListener('error', () => ui.play.classList.remove('playing'));
audio.addEventListener('loadedmetadata', () => { ui.dur.textContent = fmt(audio.duration); });
audio.addEventListener('timeupdate', () => {
  ui.cur.textContent = fmt(audio.currentTime);
  if (audio.duration) ui.seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
});
audio.addEventListener('ended', () => {
  ui.play.classList.remove('playing');
  if (ui.optTurn.checked && mode === 'reading' && active && active.k < active.N) {
    const k = active.k;
    turnTimer = setTimeout(() => { if (active && active.k === k && mode === 'reading') go(+1); }, CONFIG.autoTurnDelay);
  }
});
ui.seek.addEventListener('input', () => {
  if (audio.duration) audio.currentTime = (Number(ui.seek.value) / 1000) * audio.duration;
});

function refreshPlayer() {
  if (!active) return;
  const st = active.state();
  const { k, N } = active;
  ui.label.textContent = st?.label || (k === 0 ? '표지' : '');
  ui.count.textContent = st?.pages ? `${st.pages} / ${active.meta.pageCount}쪽` : '';
  ui.prev.disabled = k === 0;
  ui.next.disabled = k === N;
  ui.first.disabled = k === 0;
  ui.play.disabled = !st?.audio;
  ui.seek.value = '0';
  ui.cur.textContent = '0:00';
  ui.dur.textContent = '0:00';
}

function onStateChanged(flipPromise) {
  stopAudio();
  audioKey = '';
  refreshPlayer();
  const k = active.k;
  Promise.resolve(flipPromise).then(() => {
    if (!active || active.k !== k || mode !== 'reading' || !ui.optRead.checked) return;
    readTimer = setTimeout(() => { if (active && active.k === k) playCurrent(); }, CONFIG.readDelay);
  });
}

function go(dir) {
  if (!active || mode !== 'reading') return;
  const p = active.flip(dir);
  if (!p) { showHint(dir > 0 ? '마지막 쪽이에요' : '첫 쪽이에요', 1400); return; }
  onStateChanged(p);
}

async function goFirst() {
  if (!active || mode !== 'reading' || active.k === 0) return;
  stopAudio();
  let last;
  while (active.k > 1) { last = active.flip(-1, 520); await sleep(70); }
  await last;
  onStateChanged(null);
}

let hintTimer = 0;
function showHint(text, ms = 3800) {
  ui.hint.textContent = text;
  ui.hint.hidden = false;
  ui.hint.classList.remove('fade');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    ui.hint.classList.add('fade');
    hintTimer = setTimeout(() => { ui.hint.hidden = true; }, 600);
  }, ms);
}

// ================================================================== 열기·닫기
async function openBook(b) {
  if (mode !== 'shelf') return;
  mode = 'opening';
  active = b;
  b.hoverTarget = 0;
  document.body.classList.add('reading');
  if (!b.loaded) {
    ui.loading.hidden = false;
    const span = ui.loading.querySelector('span');
    await b.load((d, n) => { span.textContent = `책을 펼치는 중… ${Math.round((d / n) * 100)}%`; });
    ui.loading.hidden = true;
  }
  await tween(1100, (e) => {
    b.open = e;
    for (const o of books) if (o !== b) o.away = e;
  });
  mode = 'reading';
  ui.player.hidden = false;
  refreshPlayer();
  await sleep(120);
  go(+1);   // 표지를 넘겨 첫 펼침면으로
  const L = CONFIG.leftClick === 'next' ? '다음' : '앞';
  const R = CONFIG.rightClick === 'next' ? '다음' : '앞';
  showHint(`오른쪽 아래를 누르면 ${R} 장, 왼쪽 아래를 누르면 ${L} 장으로 넘어가요`);
}

async function closeBook() {
  if (mode !== 'reading' || !active) return;
  mode = 'closing';
  stopAudio();
  ui.player.hidden = true;
  const b = active;
  let last;
  while (b.k > 0) { last = b.flip(-1, 480); await sleep(60); }
  await last;
  await tween(1000, (e) => {
    b.open = 1 - e;
    for (const o of books) if (o !== b) o.away = 1 - e;
  });
  document.body.classList.remove('reading');
  active = null;
  mode = 'shelf';
}

// ================================================================== 입력
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(ev) {
  ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = mode === 'reading' && active ? [active.inner] : books.map((b) => b.root);
  const hit = ray.intersectObjects(targets, true).find((h) => h.object.material?.opacity !== 0 || !h.object.material.transparent);
  if (!hit) return null;
  const b = books.find((x) => { let o = hit.object; while (o) { if (o === x.root) return true; o = o.parent; } return false; });
  return { book: b, point: hit.point };
}

let downAt = null;
canvas.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
canvas.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 8) return;
  downAt = null;
  const hit = pick(ev);
  if (mode === 'shelf') {
    if (hit?.book) openBook(hit.book);
    return;
  }
  if (mode !== 'reading' || !hit || hit.book !== active) return;
  if (active.k === 0) { go(+1); return; }             // 닫힌 표지는 어디를 눌러도 펼친다
  const local = active.inner.worldToLocal(hit.point.clone());
  const act = local.x < 0 ? CONFIG.leftClick : CONFIG.rightClick;
  go(act === 'next' ? +1 : -1);
});
canvas.addEventListener('pointermove', (ev) => {
  const hit = (mode === 'shelf' || mode === 'reading') ? pick(ev) : null;
  for (const b of books) b.hoverTarget = mode === 'shelf' && hit?.book === b ? 1 : 0;
  canvas.classList.toggle('pointer', !!hit);
  if (active) {
    active.hoverCorner = null;
    if (mode === 'reading' && hit?.book === active) {
      const p = active.inner.worldToLocal(hit.point.clone());
      const z = CONFIG.curl.hoverZone, by = -active.H / 2;
      if (Math.hypot(p.x - W, p.y - by) < z) active.hoverCorner = 'R';
      else if (Math.hypot(p.x + W, p.y - by) < z) active.hoverCorner = 'L';
    }
  }
});

function setView(m, animate = true) {
  viewMode = m;
  try { localStorage.setItem('bw.view', m); } catch {}
  ui.view.classList.toggle('desk', m === 'desk');
  ui.view.title = m === 'desk' ? '정면으로 보기 (V)' : '눕혀서 보기 (V)';
  const t0 = view.tilt, t1 = TILTS[m];
  if (!animate) { view.tilt = t1; return; }
  tween(700, (e) => { view.tilt = lerp(t0, t1, e); });
}
ui.view.addEventListener('click', () => setView(viewMode === 'front' ? 'desk' : 'front'));
setView(viewMode, false);

ui.prev.addEventListener('click', () => go(-1));
ui.next.addEventListener('click', () => go(+1));
ui.first.addEventListener('click', goFirst);
ui.shelf.addEventListener('click', closeBook);
ui.play.addEventListener('click', () => { if (audio.paused || audioKey !== `${active?.meta.id}:${active?.k}`) playCurrent(); else audio.pause(); });

window.addEventListener('keydown', (ev) => {
  if (mode !== 'reading') return;
  if (ev.key === 'ArrowRight' || ev.key === 'PageDown') go(+1);
  else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') go(-1);
  else if (ev.key === 'Home') goFirst();
  else if (ev.key === 'Escape') closeBook();
  else if (ev.key === 'v' || ev.key === 'V') ui.view.click();
  else if (ev.key === ' ') { ev.preventDefault(); ui.play.click(); }
  else return;
  ev.preventDefault();
});
window.addEventListener('resize', layout);

// ================================================================== 시작
async function init() {
  const list = await (await fetch('books/index.json', { cache: 'no-cache' })).json();
  plank = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.55), new THREE.MeshLambertMaterial({ color: 0x9a6a3e }));
  plank.position.z = 0;
  scene.add(plank);
  list.forEach((meta, i) => {
    const b = new Book(meta, i);
    books.push(b);
    scene.add(b.root);
    b.loadCover();
    b.label = document.createElement('div');
    b.label.className = 'book-label';
    b.label.innerHTML = `${meta.title}<small>${meta.subtitle || ''}</small>`;
    labelsEl.appendChild(b.label);
  });
  layout();
  // 책장 판은 읽기 모드에서 사라진다
  renderer.setAnimationLoop((now) => {
    tickTweens(now);
    for (const b of books) {
      b.hover = lerp(b.hover, b.hoverTarget, 0.15);
      applyPose(b);
      b.updateCurls(now, b === active && mode === 'reading');
    }
    const t = active ? active.open : 0;
    plank.visible = t < 0.98;
    plank.position.z = -0.05 - t * 0.5;
    plank.position.y = -((books[0]?.H || 1) * 0.7) / 2 - 0.03 - t * 1.2;
    updateCamera();
    updateLabels();
    renderer.render(scene, camera);
  });
  // ?open=<id> 로 바로 펼치기 (공유·테스트용)
  const want = new URLSearchParams(location.search).get('open');
  const target = books.find((b) => b.meta.id === want);
  if (target) setTimeout(() => openBook(target), 400);
}

window.__bw = { CONFIG, books, get mode() { return mode; }, get active() { return active; }, go, openBook, closeBook };

init().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:45%;width:100%;text-align:center">책 목록을 불러오지 못했어요: ${e.message}</p>`);
});
