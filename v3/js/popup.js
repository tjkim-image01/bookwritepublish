// 팝업 레이어 — 펼침면 위에 오려 낸 그림 카드를 세운다 (web/v3)
//
// 실물 팝업북의 '90도 받침(평행 접기)'과 '종이 스프링'을 3D 로 옮긴 것 (wiki/popup/01-개발기획서.md §2):
//  - stand(세움): 카드가 바닥선(가로)을 축으로 0° → angle° 로 일어선다
//  - float(띄움): 세운 뒤 바닥에서 조금 떠서 스프링처럼 출렁인다
// 좌표는 book.inner 기준. 쪽 평면은 z≈0, 책 아래 끝 y=-H/2, 위 끝 y=+H/2, 제본선 x=0.
// 펼칠 때 뒤→앞 순서(order)로 120ms 간격 솟고, 넘기기 전에 0.25초에 접혀 내려간다.
import * as THREE from '../../v1/vendor/three.module.js';

const STAGGER_MS = 120;
const UP_MS = 700;
const DOWN_MS = 250;
const PAPER = '#f4ecdc';              // 카드 뒷면 종이색

const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
const easeIn = (t) => t * t;

// 그림의 모양(알파)만 살려 한 색으로 채운 캔버스 텍스처 — 뒷면 종이, 바닥 그림자에 쓴다
function silhouette(img, fill, blurPx = 0) {
  const c = document.createElement('canvas');
  const s = Math.min(1, 512 / Math.max(img.width, img.height));
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const g = c.getContext('2d');
  if (blurPx) g.filter = `blur(${blurPx}px)`;
  g.drawImage(img, 0, 0, c.width, c.height);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = fill;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PopupLayers {
  /** book: Book (inner, W, H, N, base, data) · tween: (ms, fn, ease) => Promise */
  constructor(book, { W, G, tween, maxAniso }) {
    this.book = book;
    this.W = W; this.G = G;
    this.tween = tween;
    this.maxAniso = maxAniso;
    this.loader = new THREE.TextureLoader();
    this.byState = new Map();          // k → [layer]
    this.shown = -1;                   // 지금 세워져 있는 상태
    this.token = 0;
  }

  hasPop(k) { return !!this.book.data?.states?.[k]?.pop?.length; }

  async preload() {
    const states = this.book.data?.states || [];
    await Promise.all(states.map((st, k) => (st.pop?.length ? this.build(k) : null)));
  }

  loadTex(url) {
    return new Promise((res) => this.loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.maxAniso; res(t); }, undefined, () => res(null)));
  }

  // 쪽 종이 맨 윗면 높이 — 왼쪽은 넘긴 낱장 더미, 오른쪽은 남은 낱장 더미 (book.zL/zR 과 같은 규칙)
  pageTop(k, x) {
    const { N } = this.book, G = this.G;
    const left = k - 1 >= 1 ? (k - 1) * G : 0.0005;
    const right = k < N ? (N - k) * G : 0.0005;
    return x < 0 ? left : right;
  }

  async build(k) {
    if (this.byState.has(k)) return this.byState.get(k);
    const specs = this.book.data.states[k].pop;
    const { W } = this;
    const H = this.book.H;
    const layers = [];
    for (const sp of specs) {
      const tex = await this.loadTex(this.book.base + sp.img);
      if (!tex) continue;
      const w = sp.w * W, h = w / sp.aspect;
      const geo = new THREE.PlaneGeometry(w, h);
      geo.translate(0, h / 2, 0);                         // 바닥선이 원점 → 회전축
      const front = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.FrontSide }));
      const back = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: silhouette(tex.image, PAPER), alphaTest: 0.5, side: THREE.BackSide }));
      const pivot = new THREE.Group();
      pivot.add(front, back);
      // 바닥 그림자: 카드 뒤(책 위쪽)로 눕는 흐린 실루엣, 세울수록 진해짐
      const shadow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: silhouette(tex.image, '#3a2410', 10), transparent: true, opacity: 0, depthWrite: false }));
      shadow.raycast = () => {};
      const group = new THREE.Group();
      const minX = sp.x - sp.w / 2, maxX = sp.x + sp.w / 2;
      const z = Math.max(this.pageTop(k, minX), this.pageTop(k, maxX)) + 0.003 + layers.length * 0.0015;
      group.position.set(sp.x * W, -H / 2 + sp.depth * H, z);
      shadow.position.z = -0.0012;
      group.add(shadow, pivot);
      group.visible = false;
      group.renderOrder = Math.round((1 - sp.depth) * 100);
      this.book.inner.add(group);
      layers.push({ sp, group, pivot, shadow, angle: 0, phase: Math.random() * 6.28 });
    }
    this.byState.set(k, layers);
    return layers;
  }

  setAngle(L, a) {
    L.angle = a;
    L.pivot.rotation.x = a;
    L.group.visible = a > 0.02;
    const s = Math.sin(Math.max(0, a));
    L.shadow.material.opacity = 0.28 * s;
    L.shadow.scale.set(1, 0.18 + 0.32 * s, 1);           // 세울수록 그림자가 뒤로 길게
  }

  /** 상태 k 의 레이어를 뒤→앞 순서로 세운다 */
  async up(k) {
    if (!this.hasPop(k)) { this.shown = k; return; }
    const token = ++this.token;
    const layers = await this.build(k);
    if (token !== this.token || this.book.k !== k) return;
    this.shown = k;
    const order = [...layers].sort((a, b) => a.sp.order - b.sp.order || b.sp.depth - a.sp.depth);
    await Promise.all(order.map((L, i) => new Promise((res) => setTimeout(() => {
      if (token !== this.token) return res();
      const target = THREE.MathUtils.degToRad(L.sp.angle || 80);
      const a0 = L.angle;
      this.tween(UP_MS, (e) => { if (token === this.token) this.setAngle(L, a0 + (target - a0) * e); }, easeOutBack).then(res);
    }, i * STAGGER_MS))));
  }

  /** 상태 k 의 레이어를 접어 내린다 (넘기기 전) */
  async down(k) {
    const layers = this.byState.get(k);
    if (!layers || !layers.some((L) => L.angle > 0.02)) return;
    const token = ++this.token;
    await Promise.all(layers.map((L) => {
      const a0 = L.angle;
      return this.tween(DOWN_MS, (e) => { if (token === this.token) this.setAngle(L, a0 * (1 - e)); }, easeIn);
    }));
    if (token === this.token) this.shown = -1;
  }

  /** 즉시 모두 숨김 (책을 닫을 때 등) */
  hideAll() {
    ++this.token;
    for (const layers of this.byState.values()) for (const L of layers) this.setAngle(L, 0);
    this.shown = -1;
  }

  /** 매 프레임: 띄움(float) 레이어 스프링 출렁임 */
  tick(now) {
    const layers = this.byState.get(this.shown);
    if (!layers) return;
    for (const L of layers) {
      if (L.sp.mode !== 'float' || L.angle < 0.3) continue;
      const t = now * 0.0021 + L.phase;
      L.pivot.position.z = 0.025 + 0.012 * Math.sin(t);  // 종이 스프링 위에 뜬 것처럼
      L.pivot.rotation.z = 0.025 * Math.sin(t * 0.7);
    }
  }
}
