import cairo, math, csv, os, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(ROOT, "results", "consolidated.csv")
S = 2


def new_surface(w, h):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, w * S, h * S)
    c = cairo.Context(surf); c.scale(S, S)
    c.set_source_rgb(1, 1, 1); c.paint()
    return surf, c


def text(c, s, x, y, size=12, bold=False, rgb=(0.12, 0.13, 0.18), align="l", rot=0):
    c.save(); c.set_source_rgb(*rgb)
    c.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL,
                       cairo.FONT_WEIGHT_BOLD if bold else cairo.FONT_WEIGHT_NORMAL)
    c.set_font_size(size); e = c.text_extents(s)
    c.translate(x, y)
    if rot: c.rotate(rot)
    if align == "c": c.move_to(-e.width / 2, 0)
    elif align == "r": c.move_to(-e.width, 0)
    else: c.move_to(0, 0)
    c.show_text(s); c.restore()


def save(surf, name, w, h):
    out = os.path.join(ROOT, "figures", name)
    surf.write_to_png(out)
    print("OK ->", out, f"({w * S}x{h * S})")


def load_rows():
    with open(CSV, newline="") as f:
        return list(csv.DictReader(f))


def fig_er():
    W, H = 900, 470
    tables = {
        "users":      (40, 40, [("id", "PK"), ("name", ""), ("email", ""), ("city", ""), ("created_at", "")]),
        "addresses":  (40, 270, [("id", "PK"), ("user_id", "FK"), ("street", ""), ("city", ""), ("state", ""), ("zip_code", "")]),
        "products":   (620, 40, [("id", "PK"), ("name", ""), ("category", ""), ("price", ""), ("stock", ""), ("created_at", "")]),
        "carts":      (350, 70, [("id", "PK"), ("user_id", "FK"), ("created_at", "")]),
        "cart_items": (620, 270, [("id", "PK"), ("cart_id", "FK"), ("product_id", "FK"), ("quantity", ""), ("unit_price", "")]),
    }
    BW, HEADER, ROW = 200, 30, 23
    box_h = lambda cols: HEADER + len(cols) * ROW

    surf, ctx = new_surface(W, H)

    def edge(name):
        x, y, cols = tables[name]
        return {"x": x, "y": y, "w": BW, "h": box_h(cols),
                "cx": x + BW / 2, "cy": y + box_h(cols) / 2,
                "right": x + BW, "bottom": y + box_h(cols)}

    ctx.set_line_width(1.6); ctx.set_source_rgb(0.30, 0.33, 0.40)

    def line(x1, y1, x2, y2):
        ctx.move_to(x1, y1); ctx.line_to(x2, y2); ctx.stroke()

    def card(txt, x, y):
        ctx.save(); ctx.set_source_rgb(0.20, 0.22, 0.28)
        ctx.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
        ctx.set_font_size(12)
        ext = ctx.text_extents(txt); ctx.move_to(x - ext.width / 2, y + 4); ctx.show_text(txt); ctx.restore()

    u, a, c, ci, p = edge("users"), edge("addresses"), edge("carts"), edge("cart_items"), edge("products")
    line(u["cx"], u["bottom"], a["cx"], a["y"]); card("1", u["cx"] + 12, u["bottom"] + 12); card("N", a["cx"] + 12, a["y"] - 10)
    line(u["right"], u["cy"], c["x"], c["cy"]); card("1", u["right"] + 12, u["cy"] - 8); card("N", c["x"] - 12, c["cy"] - 8)
    line(c["right"], c["cy"], ci["x"], ci["cy"]); card("1", c["right"] + 12, c["cy"] - 8); card("N", ci["x"] - 12, ci["cy"] - 8)
    line(p["cx"], p["bottom"], ci["cx"], ci["y"]); card("1", p["cx"] + 12, p["bottom"] + 12); card("N", ci["cx"] + 12, ci["y"] - 10)

    def rounded(x, y, w, h, r):
        ctx.new_sub_path()
        ctx.arc(x + w - r, y + r, r, -1.5708, 0); ctx.arc(x + w - r, y + h - r, r, 0, 1.5708)
        ctx.arc(x + r, y + h - r, r, 1.5708, 3.1416); ctx.arc(x + r, y + r, r, 3.1416, 4.7124)
        ctx.close_path()

    def draw_table(name):
        x, y, cols = tables[name]; h = box_h(cols)
        ctx.set_source_rgba(0, 0, 0, 0.10); rounded(x + 2, y + 3, BW, h, 8); ctx.fill()
        ctx.set_source_rgb(1, 1, 1); rounded(x, y, BW, h, 8); ctx.fill()
        ctx.set_source_rgb(0.78, 0.80, 0.85); ctx.set_line_width(1.2); rounded(x, y, BW, h, 8); ctx.stroke()
        ctx.save(); rounded(x, y, BW, h, 8); ctx.clip()
        ctx.set_source_rgb(0.16, 0.22, 0.36); ctx.rectangle(x, y, BW, HEADER); ctx.fill(); ctx.restore()
        ctx.set_source_rgb(1, 1, 1)
        ctx.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD); ctx.set_font_size(14)
        ctx.move_to(x + 12, y + 20); ctx.show_text(name)
        for i, (col, tag) in enumerate(cols):
            ry = y + HEADER + i * ROW
            if i % 2 == 1:
                ctx.set_source_rgb(0.965, 0.972, 0.982); ctx.rectangle(x + 1, ry, BW - 2, ROW); ctx.fill()
            is_pk = tag == "PK"
            ctx.set_source_rgb(0.12, 0.13, 0.18)
            ctx.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL,
                                 cairo.FONT_WEIGHT_BOLD if is_pk else cairo.FONT_WEIGHT_NORMAL)
            ctx.set_font_size(12); ctx.move_to(x + 12, ry + 16); ctx.show_text(col)
            if tag:
                ctx.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
                ctx.set_font_size(9.5)
                ctx.set_source_rgb(0.60, 0.30, 0.10) if tag == "FK" else ctx.set_source_rgb(0.10, 0.40, 0.25)
                ext = ctx.text_extents(tag); ctx.move_to(x + BW - 12 - ext.width, ry + 15); ctx.show_text(tag)
        ctx.set_source_rgb(0.78, 0.80, 0.85); ctx.set_line_width(1.0)
        ctx.move_to(x, y + HEADER); ctx.line_to(x + BW, y + HEADER); ctx.stroke()

    for t in tables:
        draw_table(t)

    save(surf, "modelo_er.png", W, H)


def fig_escalonamento():
    W, H = 1120, 600
    VUS = ["1", "10", "100"]
    CATS = ["simples", "anti-padrão", "analítico"]
    CAT_LABEL = {"simples": "simples", "anti-padrão": "anti-padrão", "analítico": "analítica"}
    STRATS = ["drizzle", "prisma"]
    colors = {"drizzle": (0.27, 0.55, 0.55), "prisma": (0.82, 0.44, 0.22)}
    dashes = {"simples": [], "anti-padrão": [11, 6], "analítico": [2, 6]}

    rows = load_rows()
    sqlp = {(r["scenario"], r["vus"]): float(r["k6_p50_ms"]) for r in rows if r["strategy"] == "sql"}
    acc = defaultdict(list)
    for r in rows:
        if r["strategy"] in STRATS:
            acc[(r["strategy"], r["category"], r["vus"])].append(
                float(r["k6_p50_ms"]) / sqlp[(r["scenario"], r["vus"])])
    gm = lambda xs: math.exp(sum(map(math.log, xs)) / len(xs))
    ratio = {k: gm(v) for k, v in acc.items()}

    ML, MR, MT, MB = 78, 250, 64, 64
    PW, PH = W - ML - MR, H - MT - MB
    ymin, ymax = 1.0, 4.7
    py = lambda v: MT + PH - (v - ymin) / (ymax - ymin) * PH
    px = lambda i: ML + (i + 0.5) / len(VUS) * PW

    surf, c = new_surface(W, H)

    text(c, "Escalonamento da sobrecarga do ORM (razão ORM/SQL do p50) com o nível de carga",
         ML + PW / 2, 26, size=15, bold=True, align="c")
    text(c, "média geométrica por classe de consulta", ML + PW / 2, 44, size=11,
         rgb=(0.45, 0.47, 0.52), align="c")

    c.set_line_width(1.0)
    v = 1.0
    while v <= ymax + 1e-9:
        y = py(v)
        c.set_source_rgb(0.90, 0.91, 0.94); c.move_to(ML, y); c.line_to(ML + PW, y); c.stroke()
        text(c, f"{v:.1f}×".replace(".", ","), ML - 8, y + 4, size=11, rgb=(0.40, 0.42, 0.48), align="r")
        v += 0.5
    text(c, "razão ORM / SQL (p50)", ML - 56, MT + PH / 2, size=12, bold=True,
         rgb=(0.30, 0.32, 0.38), align="c", rot=-math.pi / 2)

    c.save(); c.set_dash([4, 4]); c.set_line_width(1.4); c.set_source_rgb(0.55, 0.57, 0.62)
    c.move_to(ML, py(1.0)); c.line_to(ML + PW, py(1.0)); c.stroke(); c.restore()
    text(c, "paridade com o SQL (1×)", ML + PW - 4, py(1.0) - 6, size=10,
         rgb=(0.50, 0.52, 0.58), align="r")

    for i, vu in enumerate(VUS):
        text(c, f"{vu} VU", px(i), MT + PH + 22, size=12, bold=True, align="c")
    text(c, "usuários virtuais simultâneos", ML + PW / 2, MT + PH + 46, size=11,
         rgb=(0.45, 0.47, 0.52), align="c")

    for s in STRATS:
        for cat in CATS:
            pts = [(px(i), py(ratio[(s, cat, vu)])) for i, vu in enumerate(VUS)]
            c.save(); c.set_source_rgb(*colors[s]); c.set_line_width(2.6); c.set_dash(dashes[cat])
            c.move_to(*pts[0])
            for pt in pts[1:]:
                c.line_to(*pt)
            c.stroke(); c.restore()
            for (x, y) in pts:
                c.set_source_rgb(*colors[s]); c.arc(x, y, 4.2, 0, 2 * math.pi); c.fill()
                c.set_source_rgb(1, 1, 1); c.arc(x, y, 1.7, 0, 2 * math.pi); c.fill()

    c.set_source_rgb(0.55, 0.57, 0.62); c.set_line_width(1.2)
    c.rectangle(ML, MT, PW, PH); c.stroke()

    lx, ly = ML + PW + 24, MT + 14
    for s in STRATS:
        text(c, s.capitalize(), lx, ly, size=12.5, bold=True, rgb=colors[s]); ly += 22
        for cat in CATS:
            c.save(); c.set_source_rgb(*colors[s]); c.set_line_width(2.6); c.set_dash(dashes[cat])
            c.move_to(lx + 2, ly - 4); c.line_to(lx + 40, ly - 4); c.stroke(); c.restore()
            c.set_source_rgb(*colors[s]); c.arc(lx + 21, ly - 4, 4.0, 0, 2 * math.pi); c.fill()
            c.set_source_rgb(1, 1, 1); c.arc(lx + 21, ly - 4, 1.6, 0, 2 * math.pi); c.fill()
            text(c, CAT_LABEL[cat], lx + 50, ly, size=11.5)
            text(c, f"({ratio[(s, cat, '100')]:.2f}× @100)".replace(".", ","), lx + 138, ly, size=10,
                 rgb=(0.45, 0.47, 0.52))
            ly += 21
        ly += 12

    save(surf, "escalonamento_overhead.png", W, H)


def fig_vazao():
    W, H = 1120, 560
    SCENARIOS = [
        ("select_by_id",                 "select_by_id"),
        ("cart_detail",                  "cart_detail"),
        ("n_plus_one",                   "n_plus_one"),
        ("eager_join",                   "eager_join"),
        ("revenue_by_city_and_category", "revenue_city_cat"),
        ("recent_carts_7d",              "recent_carts_7d"),
        ("frequently_bought_together",   "freq_bought"),
        ("products_never_sold",          "never_sold"),
        ("browse_catalog_paginated",     "browse_catalog"),
        ("users_above_avg_spending",     "users_above_avg"),
    ]
    STRATEGIES = ["sql", "drizzle", "prisma"]

    rps = {s: {} for s in STRATEGIES}
    for row in load_rows():
        if row["vus"] == "100" and row["strategy"] in rps:
            rps[row["strategy"]][row["scenario"]] = float(row["k6_rps"])
    data = [(short, *[rps[s][csv_name] for s in STRATEGIES]) for csv_name, short in SCENARIOS]
    labels = ["SQL puro", "Drizzle", "Prisma"]
    colors = [(0.16, 0.22, 0.36), (0.27, 0.55, 0.55), (0.82, 0.44, 0.22)]

    ML, MR, MT, MB = 78, 24, 96, 132
    PW, PH = W - ML - MR, H - MT - MB
    ymin, ymax = 1.0, 30000.0
    def ly_(v):
        v = max(v, ymin)
        return MT + PH - (math.log10(v) - math.log10(ymin)) / (math.log10(ymax) - math.log10(ymin)) * PH

    surf, c = new_surface(W, H)

    text(c, "Vazão (req/s) sob 100 usuários virtuais simultâneos, por cenário e estratégia",
         W / 2, 26, size=15, bold=True, align="c")
    text(c, "escala logarítmica", W / 2, 44, size=11, rgb=(0.45, 0.47, 0.52), align="c")

    seg = [22 + len(lab) * 8 + 28 for lab in labels]
    lx, lyy = ML + (PW - (sum(seg) - 28)) / 2, 72
    for j, lab in enumerate(labels):
        c.set_source_rgb(*colors[j]); c.rectangle(lx, lyy - 10, 16, 12); c.fill()
        text(c, lab, lx + 22, lyy, size=12, bold=True)
        lx += seg[j]

    c.set_line_width(1.0)
    for p in range(0, 5):
        v = 10 ** p; y = ly_(v)
        c.set_source_rgb(0.90, 0.91, 0.94); c.move_to(ML, y); c.line_to(ML + PW, y); c.stroke()
        text(c, f"{v:,}".replace(",", "."), ML - 8, y + 4, size=11, rgb=(0.40, 0.42, 0.48), align="r")
    text(c, "req/s", ML - 58, MT + PH / 2, size=12, bold=True, rgb=(0.30, 0.32, 0.38), align="c", rot=-math.pi / 2)

    n = len(data); gw = PW / n; bw = gw * 0.74 / 3
    for i, (name, *vals) in enumerate(data):
        gx = ML + i * gw
        for j, v in enumerate(vals):
            bx = gx + gw * 0.13 + j * bw
            y = ly_(v); bh = (MT + PH) - y
            c.set_source_rgb(*colors[j]); c.rectangle(bx, y, bw, bh); c.fill()
        text(c, name, gx + gw / 2, MT + PH + 14, size=10.5, rgb=(0.20, 0.22, 0.28), align="r", rot=-math.pi / 4)
    c.set_source_rgb(0.55, 0.57, 0.62); c.set_line_width(1.2)
    c.rectangle(ML, MT, PW, PH); c.stroke()

    save(surf, "vazao_100vu.png", W, H)


FIGURAS = {"er": fig_er, "escalonamento": fig_escalonamento, "vazao": fig_vazao}

if __name__ == "__main__":
    alvos = sys.argv[1:] or list(FIGURAS)
    for nome in alvos:
        if nome not in FIGURAS:
            sys.exit(f"figura desconhecida: {nome} (use: {', '.join(FIGURAS)})")
        FIGURAS[nome]()
