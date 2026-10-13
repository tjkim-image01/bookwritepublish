// 모바일 주소창 숨기기 — v1·v2·v3·버전 안내 페이지가 함께 쓴다
//
// 뷰어는 화면이 스크롤되지 않는 3D 캔버스라서, 일반 페이지처럼 "조금 내리면 주소창이 접히는" 일이 생기지 않는다.
// 그래서 브라우저가 허락하는 두 가지 방법을 쓴다.
//   1) 전체 화면 API (안드로이드 크롬·삼성 인터넷·iPad 사파리): 화면을 처음 누르면 전체 화면으로 바꾼다.
//      사용자가 뒤로 가기 등으로 직접 빠져나오면 다시 강제하지 않고, 왼쪽 위에 '전체 화면' 버튼만 보여 준다.
//   2) 아이폰 사파리는 웹 페이지 전체 화면을 허락하지 않는다 → '홈 화면에 추가' 안내를 몇 번만 보여 준다.
//      홈 화면 아이콘으로 열면 manifest(display: fullscreen) 덕분에 주소창 없이 열린다.
(() => {
  const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
    || navigator.standalone === true;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (standalone || !touch) return;                 // 이미 앱처럼 열렸거나 PC 면 할 일 없음

  const root = document.documentElement;
  const canFS = !!(root.requestFullscreen || root.webkitRequestFullscreen)
    && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? false);

  const style = document.createElement('style');
  style.textContent = `
    #fs-btn { position: fixed; z-index: 40; top: max(10px, env(safe-area-inset-top)); left: max(10px, env(safe-area-inset-left));
      width: 40px; height: 40px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
      color: #3b2a1a; background: rgba(255, 250, 240, .85); box-shadow: 0 2px 10px rgba(70, 40, 10, .18);
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
    #fs-btn[hidden] { display: none; }
    #fs-btn svg { width: 22px; height: 22px; fill: currentColor; }
    body.mobile.reading #fs-btn { left: calc(max(10px, env(safe-area-inset-left)) + 92px); }
    #a2hs-tip { position: fixed; z-index: 40; left: 50%; bottom: max(14px, env(safe-area-inset-bottom)); transform: translateX(-50%);
      width: min(360px, calc(100% - 24px)); display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px;
      border-radius: 14px; font: 13px/1.5 NSR, 'Apple SD Gothic Neo', sans-serif; color: #fff8ea;
      background: rgba(59, 42, 26, .9); box-shadow: 0 6px 24px rgba(0, 0, 0, .25); transition: opacity .4s; }
    #a2hs-tip[hidden] { display: none; }
    #a2hs-tip b { color: #ffd9a8; }
    #a2hs-tip button { flex: none; width: 32px; height: 32px; border: 0; border-radius: 50%; padding: 0;
      font-size: 18px; line-height: 1; color: inherit; background: rgba(255, 255, 255, .14); cursor: pointer; }
  `;
  document.head.append(style);

  if (canFS) {
    const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    const enter = () => {
      try {
        const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen();
        p?.catch?.(() => {});
      } catch { /* 허락되지 않으면 그냥 둔다 */ }
    };

    const btn = document.createElement('button');
    btn.id = 'fs-btn';
    btn.hidden = true;
    btn.title = '전체 화면';
    btn.setAttribute('aria-label', '전체 화면');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z"/></svg>';
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); enter(); });

    let auto = true;          // 사용자가 직접 빠져나오기 전까지는 누를 때 자동으로 전체 화면
    let wasFS = false;
    const onChange = () => {
      const fs = isFS();
      if (wasFS && !fs) auto = false;               // 직접 나옴 → 더는 강제하지 않음
      wasFS = fs;
      btn.hidden = fs || auto;
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);

    // pointerup(터치)은 브라우저가 '사용자 동작'으로 인정하는 이벤트라 여기서 전체 화면을 요청할 수 있다
    window.addEventListener('pointerup', (ev) => {
      if (!auto || isFS() || ev.pointerType === 'mouse') return;
      enter();
      setTimeout(() => { if (!isFS()) { auto = false; btn.hidden = false; } }, 600);   // 거절되면 버튼으로
    }, { capture: true });

    document.body.append(btn);
    return;
  }

  // 아이폰 사파리: 홈 화면에 추가 안내 (최대 3번, 닫으면 다시 안 보임)
  const KEY = 'bw-a2hs-tip';
  const seen = Number(localStorage.getItem(KEY) || 0);
  if (seen < 0 || seen >= 3) return;
  localStorage.setItem(KEY, String(seen + 1));

  const tip = document.createElement('div');
  tip.id = 'a2hs-tip';
  tip.setAttribute('role', 'note');
  tip.innerHTML = '<span>주소창 없이 크게 보려면 <b>공유</b> 버튼 → <b>홈 화면에 추가</b> 후 홈 화면 아이콘으로 열어 주세요.</span>'
    + '<button aria-label="닫기">×</button>';
  tip.querySelector('button').addEventListener('click', (ev) => {
    ev.stopPropagation();
    localStorage.setItem(KEY, '-1');
    tip.remove();
  });
  document.body.append(tip);
  setTimeout(() => { tip.style.opacity = '0'; setTimeout(() => tip.remove(), 500); }, 9000);
})();
