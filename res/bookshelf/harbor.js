// Ported from koreantextbook/web/v3: harbor exhibitions, using its original CC0 models.
import * as THREE from '../../v1/vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone } from './vendor/SkeletonUtils.js';
export const DESIGNS = [
  { id: 'carousel', name: '보물 부두' },
  { id: 'balloon', name: '갑판 도서관' },
  { id: 'stairs', name: '해골섬 트레일' },
];
export const DEFAULT_DESIGN = 'stairs';
const SCALE = 0.3;
const MODELS = {};
const names = ["Dock", "Chest_Gold", "Palm_Tree", "Palm_Tree_2", "Palm_Tree_3", "Barrel", "Post", "Coins", "Small_Ship", "Anne", "Ship", "Bird", "Rocks_2", "Rocks_3", "Shark", "Skull_2", "Red_X", "Gem_Blue", "Gem_Green", "Gem_Pink", "Paper", "Skeleton"];
const loader = new GLTFLoader();
// Limit simultaneous requests and tolerate unavailable decorative models.
const failedModels = [];
const pendingModels = [...names];
const ready = Promise.all(Array.from({ length: 4 }, async () => {
  while (pendingModels.length) {
    const name = pendingModels.shift();
    const url = new URL(`./models/${name}.glb`, import.meta.url).href;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const g = await loader.loadAsync(url);
        g.box = new THREE.Box3().setFromObject(g.scene);
        g.size = g.box.getSize(new THREE.Vector3());
        MODELS[name] = g;
        break;
      } catch (error) {
        if (attempt === 1) {
          failedModels.push(name);
          console.warn(`책장 소품을 불러오지 못했습니다: ${name}`, error);
        }
      }
    }
  }
}));
const KEEP_ORIGIN = new Set(['Dock', 'Post']);
function inst(name, x=0, y=0, z=0, ry=0, size=2) {
  const g = MODELS[name], holder = new THREE.Group();
  if (!g) return holder;
  const obj = clone(g.scene);
  const s = size / (Math.max(g.size.x,g.size.y,g.size.z)||1);
  obj.scale.setScalar(s);
  obj.position.set(-(g.box.min.x+g.size.x/2)*s, KEEP_ORIGIN.has(name)?0:-g.box.min.y*s, -(g.box.min.z+g.size.z/2)*s);
  holder.add(obj); holder.position.set(x,y,z); holder.rotation.y=ry;
  holder.userData.inner=obj; return holder;
}
function character(name,x,y,z,ry,size,key) {
  const h=inst(name,x,y,z,ry,size), g=MODELS[name];
  if (!g) return {h, mixer:null};
  const mixer=new THREE.AnimationMixer(h.userData.inner);
  const clip=g.animations.find(a=>a.name.split('|').includes(key))||g.animations[0];
  if(clip) mixer.clipAction(clip).play(); return {h,mixer};
}
function pier(parent,x,z,axis,count,size) {
  for(let i=0;i<count;i++) parent.add(inst('Dock',x+i*size,0,z,0,size));
}
  function water(parent, w, d, x = 0, z = 0, y = -.5) { const geo = new THREE.PlaneGeometry(w, d, Math.min(90, Math.round(w / 1.5)), Math.min(70, Math.round(d / 1.5))); const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1FB5C9, roughness: .35, metalness: .1, transparent: true, opacity: .92 })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; m.userData.generated=true; parent.add(m); m.userData.tick = (el) => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i); p.setZ(i, Math.sin(px * .35 + el * 1.3) * .18 + Math.cos(py * .45 + el * .9) * .14); } p.needsUpdate = true; }; return m; }
  function sand(parent, w, d, x = 0, z = 0, r = 6) { const shape = new THREE.Shape(); const N = 72, n = 4; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w / 2, py = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) * d / 2; if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py); } shape.closePath(); const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xF4DCA8, roughness: 1 })); m.rotation.x = -Math.PI / 2; m.position.set(x, .02, z); m.receiveShadow = true; m.userData.generated=true; parent.add(m); return m; }
export class HarborShelf {
  constructor(scene, books, onChange) {
    this.scene=scene; this.books=books; this.world=new THREE.Group(); scene.add(this.world);
    const select=document.createElement('select'); select.id='bookshelf-select';select.disabled=true;select.setAttribute('aria-label','책장 디자인');
    DESIGNS.forEach(d=>select.add(new Option(d.name,d.id)));
    let saved;try{saved=localStorage.getItem('bw.bookshelf');}catch{}
    const canvas=document.querySelector('#stage');
    canvas.addEventListener('pointerdown',e=>{if(innerWidth/innerHeight>=0.9 && !document.body.classList.contains('reading')) this.dragX=e.clientX;});
    canvas.addEventListener('pointermove',e=>{if(this.dragX!==undefined){this.rotation=(this.rotation||0)+(e.clientX-this.dragX)*0.004;this.dragX=e.clientX;}});
    window.addEventListener('pointerup',()=>{this.dragX=undefined;});
    canvas.addEventListener('pointercancel',()=>{this.dragX=undefined;});
    this.design=DESIGNS.some(d=>d.id===saved)?saved:DEFAULT_DESIGN;
    select.value=this.design; document.body.appendChild(select);
    select.addEventListener('change',()=>{this.set(select.value);try{localStorage.setItem('bw.bookshelf',select.value);}catch{} onChange();});
  }
  async init() {
    await ready;
    this.set(this.design);
    document.querySelector('#bookshelf-select').disabled=false;
    if (failedModels.length) {
      const notice=document.createElement('p');
      notice.id='bookshelf-notice';
      notice.textContent='일부 책장 소품을 불러오지 못했어요. 책은 펼쳐 볼 수 있어요.';
      document.body.appendChild(notice);
    }
  }
  set(layout) {
    this.mixers?.forEach(m=>{m.stopAllAction();m.uncacheRoot(m.getRoot());});
    this.world.traverse(o=>{if(o.isMesh && o.userData.generated){o.geometry.dispose();o.material.dispose();}});
    this.world.clear(); this.world.scale.setScalar(SCALE); this.design=layout;
    const world=new THREE.Group(), books=this.books, n=books.length;
    const items=this.items=[],tickers=this.tickers=[],mixers=this.mixers=[];
    let camY,camZ,lookY;
    function bookMesh(b) {const m=new THREE.Group();m.userData.index=b.index;return m;}
    function npc(name,x,z,ry,clip) {const c=character(name,x,0,z,ry,2.1,clip);world.add(c.h);if(c.mixer) mixers.push(c.mixer);}
    tickers.push(water(world,120,90));
      if (layout === 'carousel') { // treasure dock
        const half = (n - 1) / 2; pier(world, -half * 2.8 - 3, 0, 'x', Math.ceil(n * 2.8 / 4.2) + 2, 4.2);
        sand(world, 14, 12, -half * 2.8 - 9, 0, 5); world.add(inst('Palm_Tree', -half * 2.8 - 12, 0, -3, .3, 5.5)); world.add(inst('Palm_Tree_2', -half * 2.8 - 8, 0, 3.5, 1.2, 5)); world.add(inst('Barrel', -half * 2.8 - 10, 0, 1.5, 0, 1.2));
        books.forEach((b, i) => { const x = (i - half) * 2.8; world.add(inst('Chest_Gold', x, 0, .4, 0, 1.4)); const m = bookMesh(b, .85); m.position.set(x, 2.4, .4); items.push({ m, ph: i, spin: true }); world.add(m); if (i % 3 === 1) world.add(inst('Post', x + 1.4, 0, -1.5, 0, 2)); });
        world.add(inst('Small_Ship', half * 2.8 + 9, -.1, -8, .8, 7)); npc('Anne', -half * 2.8 - 5, .3, Math.PI / 2, 'Wave');
        [[-half * 2.8 - 1, -3.5], [half * 2.8 + 2, 3]].forEach(([x, z], i) => { const g = inst('Coins', x, 0, z, 0, .9); g.userData.ph = i; world.add(g); items.push({ coin: g }); });
        camY = 10; camZ = 24; lookY = 1.6;
      } else if (layout === 'balloon') { // ship deck library
        world.add(inst('Ship', 0, -.2, -2, 0, 20));
        const rows = 2, per = Math.ceil(n / rows);
        books.forEach((b, i) => { const r = Math.floor(i / per), c = i % per, cnt = Math.min(per, n - r * per); const x = (c - (cnt - 1) / 2) * 2.6; const m = bookMesh(b, .85); m.position.set(x, 6.2 + r * 2.1, -2 + (r ? -1.6 : 1.4)); items.push({ m, ph: i, spin: true }); world.add(m); });
        for (let i = 0; i < 3; i++) { const bd = inst('Bird', 0, 11 + i, 0, 0, .9); bd.userData.ph = i * 2; bd.userData.r = 9 + i * 2; world.add(bd); items.push({ gull: bd }); }
        world.add(inst('Rocks_3', -20, -.2, -14, .3, 6)); world.add(inst('Rocks_3', 19, -.2, -12, 0, 4));
        const sh = character('Shark', 12, -.35, 8, 0, 4.5, 'Swim'); world.add(sh.h); if (sh.mixer) mixers.push(sh.mixer); items.push({ shark: sh.h });
        camY = 12; camZ = 28; lookY = 4.5;
      } else { // skull island trail
        sand(world, 34, 26, 0, 0, 10);
        world.add(inst('Skull_2', 0, 0, -8, 0, 5)); world.add(inst('Rocks_2', -13, 0, -7, .4, 6)); world.add(inst('Rocks_3', 13, 0, -6, -.6, 5));
        [[-14, 6], [14, 7], [-9, -10], [10, -10], [4, 11]].forEach(([x, z], i) => world.add(inst(['Palm_Tree', 'Palm_Tree_2', 'Palm_Tree_3'][i % 3], x, 0, z, i, 5.5)));
        const path = []; for (let i = 0; i < n; i++) { const tt = i / Math.max(1, n - 1); path.push([Math.sin(tt * Math.PI * 1.6) * 9, 8 - tt * 14]); }
        path.forEach(([x, z], i) => { world.add(inst('Red_X', x, .04, z, 0, 1.6)); const m = bookMesh(books[i], .85); m.position.set(x, 2.4, z); items.push({ m, ph: i, spin: true }); world.add(m); if (i % 2) world.add(inst(['Gem_Blue', 'Gem_Green', 'Gem_Pink'][i % 3], x + 1.3, .05, z + .8, i, .7)); });
        world.add(inst('Post', 3, 0, 10, -.4, 2)); world.add(inst('Paper', -3, 0, 10.5, .5, 1.1)); world.add(inst('Chest_Gold', -5, 0, -1, .6, 1.5)); npc('Skeleton', 6, -4, -.6, 'Idle');
        camY = 14; camZ = 24; lookY = 1;
      }

    items.forEach(it=>{if(it.m) it.m.userData.y=it.m.position.y;});

    this.look = lookY * SCALE;
    this.camY = camY * SCALE;
    this.camZ = Math.max(camZ, layout==='carousel' ? n*2.9 : 0) * SCALE;
    this.world.add(world);
  }
  pose(index, hover=0, away=0) {
    const item = this.items.find(it=>it.m?.userData.index===index);
    const p=item?.m.position || new THREE.Vector3();
    const a=this.world.rotation.y, x=p.x*SCALE, z=p.z*SCALE;
    return {x:x*Math.cos(a)+z*Math.sin(a), y:p.y*SCALE+hover*0.05-away*3,
      z:z*Math.cos(a)-x*Math.sin(a), rx:0, ry:0.12*(1-hover), s:0.65};
  }
  camera(pos,look,aspect,focus=0) {
    if (aspect < 0.9) {
      const p=this.pose(focus);
      pos.set(p.x,p.y+1.6,p.z+4.0);
      look.set(p.x,p.y,p.z);
      return;
    }
    const extra=Math.max(1.25, 1.6/aspect);
    pos.set(0,this.camY*extra,this.camZ*extra);
    look.set(0,this.look,0);
  }
  tick(now, open) {
    const el=now/1000, dt=Math.min((now-(this.last||now))/1000,0.05); this.last=now;
    this.world.visible=open<0.01;
    this.tickers.forEach(m=>m.userData.tick(el)); this.mixers.forEach(m=>m.update(dt));
    for(const it of this.items) {
      if(it.m) it.m.position.y=it.m.userData.y+Math.sin(el*1.5+it.ph)*0.12;
      if(it.coin) it.coin.rotation.y=el*1.4+(it.coin.userData.ph||0);
      if(it.gull) {const a=el*0.5+it.gull.userData.ph, r=it.gull.userData.r; it.gull.position.set(Math.cos(a)*r,11+Math.sin(el+it.gull.userData.ph),-2+Math.sin(a)*r*0.6);it.gull.rotation.y=-a;}
      if(it.shark) {const a=el*0.4;it.shark.position.set(Math.cos(a)*14,-0.35,4+Math.sin(a)*9);it.shark.rotation.y=-a+Math.PI*1.5;}
    }
    this.world.rotation.y=(this.rotation||0)+Math.sin(el*0.06)*0.08;
    document.querySelector('#bookshelf-select').hidden=open>0.01;
  }
}
