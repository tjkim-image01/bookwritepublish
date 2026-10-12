"""프로젝트의 완성본을 뷰어 책장(web/res/books — v1·v2 공용)으로 가져온다.

    python3 web/tools/import_book.py project/j001

읽는 것 (프로젝트 폴더 기준)
    story/manuscript.json     제목·장면 이름
    output/*-print.pdf        조판된 낱장 PDF → 쪽 이미지 (pdftoppm)
    output/audio/sNN.mp3      상태별 낭독 (없으면 그 상태는 소리 없음)
만드는 것
    web/res/books/<id>/pages/pNN.jpg, audio/sNN.mp3, book.json
    web/res/books/index.json   책장 목록 (같은 id 는 갱신, cover 는 books/ 기준 상대 경로)

상태 번호 k = 넘긴 낱장 수: 0 표지 · 1 속표지(2-3쪽) · 2.. 본문 펼침면 · 마지막 = 맨 끝 쪽
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

WEB = Path(__file__).resolve().parents[1]
PAGE_PX = 1400


def main(project_dir: str):
    proj = Path(project_dir).resolve()
    bid = proj.name
    m = json.loads((proj / "story" / "manuscript.json").read_text(encoding="utf-8"))
    pdfs = sorted((proj / "output").glob("*-print.pdf"))
    if not pdfs:
        sys.exit(f"조판 PDF가 없습니다: {proj / 'output'}/*-print.pdf")

    dst = WEB / "res" / "books" / bid
    shutil.rmtree(dst, ignore_errors=True)
    (dst / "pages").mkdir(parents=True)
    (dst / "audio").mkdir()

    # 쪽 이미지
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-png", "-scale-to", str(PAGE_PX), str(pdfs[0]), f"{tmp}/p"], check=True)
        raws = sorted(Path(tmp).glob("p-*.png"))
        pages = []
        for n, f in enumerate(raws, 1):
            name = f"pages/p{n:02d}.jpg"
            Image.open(f).convert("RGB").save(dst / name, quality=86, optimize=True)
            pages.append(name)
    count = len(pages)
    aspect = 1.0
    with Image.open(dst / pages[0]) as im:
        aspect = round(im.width / im.height, 4)

    # 상태 목록 (넘긴 낱장 수마다 하나)
    leaves = (count + 1) // 2
    spreads = m.get("spreads", [])
    states = []
    for k in range(leaves + 1):
        if k == 0:
            label, pg = m["title"], "1"
        elif k == leaves:
            label, pg = "함께 이야기해요", str(count)
        elif k == 1:
            label, pg = "속표지", "2-3"
        else:
            s = spreads[k - 2] if k - 2 < len(spreads) else {}
            label, pg = s.get("heading", ""), f"{2 * k}-{2 * k + 1}"
        st = {"k": k, "label": label, "pages": pg}
        mp3 = proj / "output" / "audio" / f"s{k:02d}.mp3"
        if mp3.exists():
            shutil.copy2(mp3, dst / "audio" / mp3.name)
            st["audio"] = f"audio/{mp3.name}"
        states.append(st)

    book = {"id": bid, "title": m["title"], "subtitle": m.get("subtitle", ""), "version": m.get("version", ""),
            "pageCount": count, "aspect": aspect, "pages": pages, "states": states}
    (dst / "book.json").write_text(json.dumps(book, ensure_ascii=False, indent=1), encoding="utf-8")

    idx_file = WEB / "res" / "books" / "index.json"
    idx = json.loads(idx_file.read_text(encoding="utf-8")) if idx_file.exists() else []
    entry = {"id": bid, "title": m["title"], "subtitle": m.get("subtitle", ""), "cover": f"{bid}/{pages[0]}",
             "pageCount": count, "aspect": aspect}
    idx = [e for e in idx if e["id"] != bid] + [entry]
    idx_file.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")

    voiced = sum(1 for s in states if "audio" in s)
    print(f"{bid}: {count}쪽, 상태 {len(states)}개 (낭독 {voiced}개) → {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
