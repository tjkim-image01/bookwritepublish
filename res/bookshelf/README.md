# 책장 디자인

`koreantextbook/web/v3`의 항구 곳곳 기획전 3종을 이식했습니다.

1. `carousel` — 보물 부두
2. `balloon` — 갑판 도서관
3. `stairs` — 해골섬 트레일 (기본)

v1·v2·v3에서 `harbor.js`와 `models/`를 공유합니다. 책장 디자인 선택은 `bw.bookshelf`에 저장하여 다음 방문에도 유지합니다. 저장된 선택이 없으면 해골섬 트레일이 표시됩니다. 책을 펼치면 항구를 숨기고 기존 읽기 모드로 전환합니다.

원본 배치: `koreantextbook/web/v3/frontend/components/three/exhibition-stage.tsx`, `res/vc02/app.js`.
모델: Quaternius Pirate Kit, CC0 (`LICENSE_Quaternius_CC0.txt`). Three.js 로더: r160, MIT.
