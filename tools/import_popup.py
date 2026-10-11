"""팝업북 원본(project-popup/<id>)을 팝업 뷰어 책장(web/books-popup)으로 가져온다.

    python3 web/tools/import_popup.py project-popup/j001

하는 일
    1. 조판 PDF(output/*-print.pdf) → 쪽 그림 pages/pNN.jpg
    2. 레이어(images/raw/*-L*.png, 초록 배경) → 초록 키잉 + 초록 번짐 제거 + 흰 오림선 + 여백 자르기 → layers/*.png
    3. 낭독: 원본 책(project/<원본>)의 output/audio/sNN.mp3 복사 (글이 같으므로)
    4. 05-popup.md(배치표) → book.json 의 states[k].pop, books-popup/index.json 갱신

배치표 형식 (05-popup.md)
    ## k5 — 요단강에 발을 디디면
    | 레이어 | 그림 | x | 깊이 | 폭 | 방식 | 각도 | 순서 |
    | 제사장 | s05-L1 | 0.15 | 0.42 | 0.80 | 세움 | 78 | 1 |
    x: 펼침면 가로 (-1 왼쪽 끝 · 0 제본선 · 1 오른쪽 끝, 레이어 가운데) / 깊이: 바닥선 (0 책 아래 끝 · 1 위 끝)
    폭: 쪽 폭 = 1 / 방식: 세움(stand) · 띄움(float) / 각도: 세운 각도(도) / 순서: 솟는 차례
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parent
PAGE_PX = 1400
LAYER_MAX = 1024


# ------------------------------------------------------------------ 레이어 그림
def key_green(im: Image.Image) -> Image.Image:
    """초록 배경 → 투명. 색상(Hue)이 초록이고 채도·명도가 높은 곳을 배경으로 본다. 가장자리는 반투명, 남은 초록은 뺀다."""
    rgb = im.convert("RGB")
    hsv = rgb.convert("HSV")
    h, s, v = [c.load() for c in hsv.split()]
    r, g, b = [c.load() for c in rgb.split()]
    W, H = rgb.size
    alpha = Image.new("L", (W, H), 255)
    a = alpha.load()
    out = rgb.copy()
    o = out.load()
    for y in range(H):
        for x in range(W):
            hh, ss, vv = h[x, y], s[x, y], v[x, y]          # PIL HSV: 0~255
            rr, gg, bb = r[x, y], g[x, y], b[x, y]
            green = gg - max(rr, bb)                        # 초록이 다른 색보다 얼마나 센가
            if 55 <= hh <= 120 and ss > 90 and vv > 70 and green > 40:
                a[x, y] = 0
            elif green > 20:                                 # 가장자리: 초록 기운만큼 투명 + 초록 빼기
                a[x, y] = max(0, 255 - int((green - 20) * 6))
                o[x, y] = (rr, max(rr, bb), bb)
    alpha = alpha.filter(ImageFilter.MinFilter(3))           # 가장자리 초록 테 1px 깎기
    alpha = keep_main_parts(alpha)                           # Flow 워터마크(✦) 같은 떨어진 작은 조각 지우기
    out.putalpha(alpha)
    return out


def keep_main_parts(alpha: Image.Image, min_ratio: float = 0.02) -> Image.Image:
    """불투명 영역을 덩어리별로 나눠, 가장 큰 덩어리의 2퍼센트보다 작은 조각은 지운다 (축소본에서 계산)."""
    W, H = alpha.size
    sc = max(1, max(W, H) // 256)
    small = alpha.resize((W // sc, H // sc)).point(lambda v: 1 if v > 40 else 0)
    w, h = small.size
    px = small.load()
    label = [[0] * w for _ in range(h)]
    sizes = {}
    cur = 0
    for y in range(h):
        for x in range(w):
            if px[x, y] and not label[y][x]:
                cur += 1
                stack, n = [(x, y)], 0
                label[y][x] = cur
                while stack:
                    cx, cy = stack.pop()
                    n += 1
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not label[ny][nx]:
                            label[ny][nx] = cur
                            stack.append((nx, ny))
                sizes[cur] = n
    if not sizes:
        return alpha
    biggest = max(sizes.values())
    drop = {k for k, n in sizes.items() if n < biggest * min_ratio}
    if not drop:
        return alpha
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if label[y][x] in drop:
                mp[x, y] = 0
    mask = mask.resize((W, H)).filter(ImageFilter.MinFilter(5))
    return ImageChops.multiply(alpha, mask)


def die_cut(im: Image.Image, border: int = 5) -> Image.Image:
    """흰 오림선(테두리)을 깔고 여백을 자른다 — 실물 팝업북에서 칼로 오려 낸 종이 느낌."""
    a = im.getchannel("A")
    solid = a.point(lambda v: 255 if v > 40 else 0)
    grow = solid.filter(ImageFilter.MaxFilter(border * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2))
    grow = grow.point(lambda v: 255 if v > 110 else 0)
    paper = Image.new("RGBA", im.size, (253, 249, 238, 0))
    paper.putalpha(grow)
    edge = grow.filter(ImageFilter.MaxFilter(3))             # 아주 옅은 바깥 선
    line = Image.new("RGBA", im.size, (150, 128, 100, 0))
    line.putalpha(ImageChops.subtract(edge, grow).point(lambda v: min(v, 110)))
    base = Image.alpha_composite(line, paper)
    card = Image.alpha_composite(base, im)
    box = card.getchannel("A").getbbox()
    if box:
        pad = 4
        card = card.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(card.width, box[2] + pad), min(card.height, box[3] + pad)))
    card.thumbnail((LAYER_MAX, LAYER_MAX))
    return card


# ------------------------------------------------------------------ 배치표
def parse_popup_md(path: Path) -> dict:
    """## k<번호> 절의 표 → {k: [레이어 dict]}"""
    out, k, head = {}, None, None
    mode_map = {"세움": "stand", "띄움": "float"}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^## k(\d+)", line)
        if m:
            k, head = int(m.group(1)), None
            out[k] = []
            continue
        if k is None or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if head is None:
            head = cells
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        row = dict(zip(head, cells))
        out[k].append({"name": row["레이어"], "img": row["그림"], "x": float(row["x"]), "depth": float(row["깊이"]),
                       "w": float(row["폭"]), "mode": mode_map.get(row["방식"], "stand"),
                       "angle": float(row.get("각도") or 80), "order": int(row.get("순서") or 1)})
    return out


# ------------------------------------------------------------------ main
def main(project_dir: str):
    proj = (ROOT / project_dir).resolve() if not Path(project_dir).is_absolute() else Path(project_dir)
    bid = "p" + proj.name[1:] if proj.name.startswith("j") else proj.name    # project-popup/j001 → p001
    m = json.loads((proj / "story" / "manuscript.json").read_text(encoding="utf-8"))
    src_audio = ROOT / "project" / proj.name / "output" / "audio"            # 원본 책 낭독
    pdfs = sorted((proj / "output").glob("*-print.pdf"))
    if not pdfs:
        sys.exit(f"조판 PDF가 없습니다: {proj / 'output'}/*-print.pdf (build/build_book.py 먼저)")

    dst = WEB / "books-popup" / bid
    shutil.rmtree(dst, ignore_errors=True)
    for d in ("pages", "layers", "audio"):
        (dst / d).mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-png", "-scale-to", str(PAGE_PX), str(pdfs[0]), f"{tmp}/p"], check=True)
        pages = []
        for n, f in enumerate(sorted(Path(tmp).glob("p-*.png")), 1):
            name = f"pages/p{n:02d}.jpg"
            Image.open(f).convert("RGB").save(dst / name, quality=86, optimize=True)
            pages.append(name)
    count = len(pages)

    pops = parse_popup_md(proj / "05-popup.md") if (proj / "05-popup.md").exists() else {}
    made = {}
    for k, layers in pops.items():
        for L in layers:
            if L["img"] in made:
                continue
            src = proj / "images" / "raw" / f"{L['img']}.png"
            if not src.exists():
                print(f"  ! 레이어 그림 없음: {src.name} (건너뜀)")
                continue
            card = die_cut(key_green(Image.open(src)))
            card.save(dst / "layers" / f"{L['img']}.png", optimize=True)
            made[L["img"]] = card.width / card.height
            print(f"  레이어 {L['img']}: {card.size}")

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
        mp3 = src_audio / f"s{k:02d}.mp3"
        if mp3.exists():
            shutil.copy2(mp3, dst / "audio" / mp3.name)
            st["audio"] = f"audio/{mp3.name}"
        pop = [dict(L, img=f"layers/{L['img']}.png", aspect=round(made[L["img"]], 4))
               for L in pops.get(k, []) if L["img"] in made]
        if pop:
            st["pop"] = sorted(pop, key=lambda L: L["order"])
        states.append(st)

    book = {"id": bid, "title": m["title"], "subtitle": m.get("subtitle", ""), "version": m.get("version", ""),
            "pageCount": count, "aspect": 1.0, "pages": pages, "states": states, "popup": True}
    (dst / "book.json").write_text(json.dumps(book, ensure_ascii=False, indent=1), encoding="utf-8")

    idx_file = WEB / "books-popup" / "index.json"
    idx = json.loads(idx_file.read_text(encoding="utf-8")) if idx_file.exists() else []
    entry = {"id": bid, "title": m["title"], "subtitle": m.get("subtitle", ""), "cover": f"{bid}/{pages[0]}",
             "pageCount": count, "aspect": 1.0}
    idx = [e for e in idx if e["id"] != bid] + [entry]
    idx_file.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    n_pop = sum(1 for s in states if "pop" in s)
    print(f"{bid}: {count}쪽, 팝업 펼침면 {n_pop}개, 레이어 {len(made)}장, 낭독 {sum(1 for s in states if 'audio' in s)}개 → {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
