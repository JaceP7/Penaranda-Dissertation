"""Redraw Figures 1 and 2 against the stack that is actually deployed.

The previous figures described the pre-cloud pipeline: llama-3.3-70b, FAISS
IndexFlatIP, a bge-reranker-base cross-encoder, 235 services and a local
query_log.jsonl. None of that is what runs. Current, verified from the code and
the live index on 2026-10-13:

  retrieval   Upstash Vector, built-in text-embedding-3-small, 1536-d, COSINE,
              305 services over 31 offices  (GET /info on the live index)
  reranker    none - removed after an ablation showed it hurt retrieval
              (MRR 0.768 -> 0.671, P@1 0.750 -> 0.571)
  generation  Groq openai/gpt-oss-120b, reasoning_effort low, 1600 max tokens
  state       Upstash Redis: wf:querylog, wf:navlog, wf:mapstate(+:hist)
  functions   /api/chat, /api/analytics, /api/navlog, /api/mapstate,
              /api/adminauth, /api/ping

One layout spec emits both outputs, so the .drawio source and the .png can
never drift apart.

Run: python tools/make_figures.py
"""
import io
import os
import sys
import xml.sax.saxutils as sax

from PIL import Image, ImageDraw, ImageFont

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "figures")

# ── palette, matching the previous figures so the set still reads as one ─────
STYLES = {
    "entity":    dict(fill="#FFF2CC", line="#D6B656", text="#7F6000"),  # external actors
    "frontend":  dict(fill="#D5E8D4", line="#82B366", text="#1E4620"),  # client modules
    "process":   dict(fill="#DAE8FC", line="#6C8EBF", text="#15385C"),  # serverless
    "store":     dict(fill="#E1D5E7", line="#9673A6", text="#4B2E57"),  # data stores
    "external":  dict(fill="#FFE6CC", line="#D79B00", text="#7A4100"),  # third-party
    "group":     dict(fill="#FFFFFF", line="#B3B3B3", text="#555555"),  # container
}


class Fig:
    def __init__(self, name, w, h, title):
        self.name, self.w, self.h, self.title = name, w, h, title
        self.nodes, self.edges = [], []

    def box(self, nid, x, y, w, h, label, kind="process", dashed=False, rounded=True):
        self.nodes.append(dict(id=nid, x=x, y=y, w=w, h=h, label=label,
                               kind=kind, dashed=dashed, rounded=rounded))
        return nid

    def edge(self, src, dst, label="", dashed=False):
        self.edges.append(dict(src=src, dst=dst, label=label, dashed=dashed))

    def node(self, nid):
        return next(n for n in self.nodes if n["id"] == nid)

    # ── drawio ───────────────────────────────────────────────────────────────
    def to_drawio(self):
        cells = []
        for n in self.nodes:
            s = STYLES[n["kind"]]
            style = (f"rounded={1 if n['rounded'] else 0};whiteSpace=wrap;html=1;"
                     f"fillColor={s['fill']};strokeColor={s['line']};fontColor={s['text']};"
                     f"fontSize=12;align=center;verticalAlign=middle;arcSize=8;")
            if n["dashed"]:
                style += "dashed=1;"
            if n["kind"] == "group":
                style += "verticalAlign=top;fontSize=13;fontStyle=1;spacingTop=6;"
            cells.append(
                f'<mxCell id="{n["id"]}" value="{sax.escape(n["label"])}" style="{style}" '
                f'vertex="1" parent="1"><mxGeometry x="{n["x"]}" y="{n["y"]}" '
                f'width="{n["w"]}" height="{n["h"]}" as="geometry"/></mxCell>')
        for i, e in enumerate(self.edges):
            style = ("edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=11;"
                     "strokeColor=#555555;fontColor=#333333;endArrow=block;endFill=1;")
            if e["dashed"]:
                style += "dashed=1;"
            cells.append(
                f'<mxCell id="e{i}" value="{sax.escape(e["label"])}" style="{style}" '
                f'edge="1" parent="1" source="{e["src"]}" target="{e["dst"]}">'
                f'<mxGeometry relative="1" as="geometry"/></mxCell>')
        body = "\n        ".join(cells)
        return (f'<mxfile host="app.diagrams.net" type="device">\n'
                f'  <diagram name="{sax.escape(self.title)}" id="{self.name}">\n'
                f'    <mxGraphModel dx="1422" dy="800" grid="1" gridSize="10" guides="1" '
                f'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
                f'pageWidth="{self.w}" pageHeight="{self.h}" math="0" shadow="0">\n'
                f'      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n'
                f'        {body}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n')

    # ── png ──────────────────────────────────────────────────────────────────
    def to_png(self, scale=2):
        W, H = self.w * scale, (self.h + 46) * scale
        img = Image.new("RGB", (W, H), "white")
        d = ImageDraw.Draw(img)

        def fnt(sz, bold=False):
            for nm in ((["arialbd.ttf"] if bold else ["arial.ttf"])):
                try:
                    return ImageFont.truetype(rf"C:\Windows\Fonts\{nm}", sz * scale)
                except Exception:
                    pass
            return ImageFont.load_default()

        def wrap(text, f, maxw):
            out = []
            for para in text.split("\n"):
                line = ""
                for word in para.split():
                    t = (line + " " + word).strip()
                    if d.textlength(t, font=f) > maxw and line:
                        out.append(line)
                        line = word
                    else:
                        line = t
                out.append(line)
            return out

        # Edges as straight centre-to-centre lines clipped at the box borders.
        # An orthogonal router would put every horizontal run at the midpoint
        # between its endpoints, so edges at similar heights share a lane and
        # their labels overlap into nonsense. Straight lines are conventional in
        # a DFD and give each label its own position.
        import math

        def clip(n, tx, ty):
            """Where the line to (tx,ty) leaves node n's rectangle."""
            cx, cy = (n["x"] + n["w"] / 2) * scale, (n["y"] + n["h"] / 2) * scale
            hw, hh = n["w"] * scale / 2, n["h"] * scale / 2
            dx, dy = tx - cx, ty - cy
            if dx == 0 and dy == 0:
                return cx, cy
            sx = hw / abs(dx) if dx else float("inf")
            sy = hh / abs(dy) if dy else float("inf")
            t = min(sx, sy)
            return cx + dx * t, cy + dy * t

        pending_labels = []
        placed = []          # label rects already committed
        for i, e in enumerate(self.edges):
            a, b = self.node(e["src"]), self.node(e["dst"])
            acx, acy = (a["x"] + a["w"] / 2) * scale, (a["y"] + a["h"] / 2) * scale
            bcx, bcy = (b["x"] + b["w"] / 2) * scale, (b["y"] + b["h"] / 2) * scale
            ax, ay = clip(a, bcx, bcy)
            bx, by = clip(b, acx, acy)
            d.line([(ax, ay), (bx, by)], fill="#8A8A8A", width=max(1, scale))

            ang = math.atan2(by - ay, bx - ax)
            s = 6 * scale
            d.polygon([(bx, by),
                       (bx - s * math.cos(ang - 0.42), by - s * math.sin(ang - 0.42)),
                       (bx - s * math.cos(ang + 0.42), by - s * math.sin(ang + 0.42))],
                      fill="#8A8A8A")

            if e["label"]:
                # Walk outward from the midpoint for a spot where the label sits
                # on neither a box nor an already-placed label. Without this a
                # label lands on a box title and obscures it.
                lw = d.textlength(e["label"], fnt(9))
                lh = 13 * scale
                best = None
                for t in (0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.20, 0.80):
                    for sgn in ((1, -1) if i % 2 == 0 else (-1, 1)):
                        off = 11 * scale * sgn
                        cx = ax + (bx - ax) * t - math.sin(ang) * off
                        cy = ay + (by - ay) * t + math.cos(ang) * off
                        r = (cx - lw / 2 - 3 * scale, cy - lh / 2,
                             cx + lw / 2 + 3 * scale, cy + lh / 2)
                        if best is None:
                            best = (cx, cy)
                        hit = any(not (r[2] < n["x"] * scale or r[0] > (n["x"] + n["w"]) * scale or
                                       r[3] < n["y"] * scale or r[1] > (n["y"] + n["h"]) * scale)
                                  for n in self.nodes)
                        hit = hit or any(not (r[2] < q[0] or r[0] > q[2] or
                                              r[3] < q[1] or r[1] > q[3]) for q in placed)
                        if not hit:
                            best = (cx, cy)
                            placed.append(r)
                            break
                    else:
                        continue
                    break
                pending_labels.append((best[0], best[1], e["label"]))

        for n in self.nodes:
            s = STYLES[n["kind"]]
            x0, y0 = n["x"] * scale, n["y"] * scale
            x1, y1 = (n["x"] + n["w"]) * scale, (n["y"] + n["h"]) * scale
            r = 8 * scale if n["rounded"] else 0
            d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=s["fill"],
                                outline=s["line"], width=max(1, scale))
            if n["kind"] == "group":
                f = fnt(11, True)
                d.text((x0 + 12 * scale, y0 + 8 * scale), n["label"], font=f, fill=s["text"])
                continue
            head, *rest = n["label"].split("\n", 1)
            fh, fb = fnt(10, True), fnt(9)
            lines = [(l, fh) for l in wrap(head, fh, n["w"] * scale - 18 * scale)]
            if rest:
                lines += [(l, fb) for l in wrap(rest[0], fb, n["w"] * scale - 18 * scale)]
            th = sum((11 if f is fh else 10) * scale + 2 * scale for _, f in lines)
            ty = y0 + ((y1 - y0) - th) / 2
            for text, f in lines:
                tw = d.textlength(text, font=f)
                d.text((x0 + ((x1 - x0) - tw) / 2, ty), text, font=f, fill=s["text"])
                ty += (11 if f is fh else 10) * scale + 2 * scale

        # Labels last: boxes are drawn after the lines, so a label placed
        # earlier would be painted over wherever a line passes behind a box.
        fl = fnt(9)
        for lx, ly, text in pending_labels:
            lw = d.textlength(text, font=fl)
            x0, y0 = lx - lw / 2, ly - 6 * scale
            d.rectangle([x0 - 3 * scale, y0 - scale, x0 + lw + 3 * scale, y0 + 12 * scale],
                        fill="white", outline="white")
            d.text((x0, y0), text, font=fl, fill="#333333")

        cap = fnt(12, True)
        cw = d.textlength(self.title, font=cap)
        d.text(((W - cw) / 2, H - 34 * scale), self.title, font=cap, fill="#111111")
        return img

    def save(self):
        os.makedirs(OUT, exist_ok=True)
        base = os.path.join(OUT, self.name)
        io.open(base + ".drawio", "w", encoding="utf-8").write(self.to_drawio())
        self.to_png().save(base + ".png")
        print(f"  {self.name}.drawio + .png  ({len(self.nodes)} boxes, {len(self.edges)} flows)")


# ═══ Figure 1 — Unified System Architecture ══════════════════════════════════
def figure1():
    f = Fig("Figure_1_Unified_System_Architecture_v2", 1180, 800,
            "Figure 1 \u2014 Unified System Architecture (serverless deployment)")

    f.box("user", 400, 20, 380, 56,
          "Citizen / Administrator\nBrowser on own phone or desktop \u2014 no install", "entity")

    f.box("fegrp", 60, 118, 1060, 176, "Frontend \u2014 static web app on Vercel "
          "(HTML / CSS / vanilla JS, localStorage, service worker)", "group")
    f.box("m1", 85, 162, 330, 112, "Conversational AI\nchat.js \u2014 starter chips, "
          "Taglish input, answer panel, \u201cTake me there\u201d", "frontend")
    f.box("m2", 425, 162, 330, 112, "Indoor Wayfinding\n75\u00d775 grid \u00d7 4 floors \u00b7 "
          "QR deep-link anchors \u00b7 PDR backup \u00b7 Dijkstra routing", "frontend")
    f.box("m3", 765, 162, 330, 112, "Admin & Analytics\nMap editor, draft/live publishing "
          "with rollback, dashboard", "frontend")

    f.box("fn", 60, 352, 1060, 92, "Vercel serverless functions\n"
          "/api/chat  \u00b7  /api/navlog  \u00b7  /api/analytics  \u00b7  "
          "/api/mapstate  \u00b7  /api/adminauth  \u00b7  /api/ping", "process")

    f.box("vec", 60, 520, 330, 124, "Upstash Vector\ntext-embedding-3-small, 1536-d, COSINE\n"
          "305 services \u00b7 31 offices \u00b7 server-side embedding", "external")
    f.box("llm", 425, 520, 330, 124, "Groq Cloud\nopenai/gpt-oss-120b\n"
          "reasoning_effort: low \u00b7 1600 max tokens", "external")
    f.box("red", 790, 520, 330, 124, "Upstash Redis\nwf:querylog \u00b7 wf:navlog\n"
          "wf:mapstate (+ :hist, last 10 versions)", "store")

    f.box("note", 60, 686, 1060, 56,
          "No reranker. A cross-encoder was tested and removed: on the same retrieval pool it "
          "lowered MRR 0.768\u21920.671 and P@1 0.750\u21920.571.\nIts absence is an "
          "evidence-based decision, not an omission.", "group", dashed=True)

    f.edge("user", "fegrp", "HTTPS / UI")
    f.edge("m1", "fn", "question")
    f.edge("m2", "fn", "route events")
    f.edge("m3", "fn", "publish / read")
    f.edge("fn", "vec", "top-6 retrieval")
    f.edge("fn", "llm", "grounded prompt")
    f.edge("fn", "red", "logs + map state")
    return f


# ═══ Figure 2 — Level-1 Data Flow Diagram ════════════════════════════════════
def figure2():
    f = Fig("Figure_2_Level1_DFD_v2", 1180, 840,
            "Figure 2 \u2014 Level-1 Data Flow Diagram")

    f.box("citizen", 60, 40, 240, 62, "Citizen\n(public user)", "entity", rounded=False)
    f.box("admin", 880, 40, 240, 62, "Administrator\n(LGU staff)", "entity", rounded=False)
    f.box("groq", 470, 40, 240, 62, "Groq Cloud LLM\n(external service)", "external", rounded=False)

    f.box("p1", 60, 180, 260, 86, "P1  Query processing\nLanguage detection (fil / en), "
          "history-aware rewrite", "process")
    f.box("p2", 460, 180, 260, 86, "P2  RAG retrieval &\nanswer generation\n"
          "top-6 \u2192 grounded answer \u2192 office", "process")
    f.box("p5", 860, 180, 260, 86, "P5  Map authoring\n& publishing\n"
          "draft \u2192 diff \u2192 publish / rollback", "process")

    f.box("p3", 260, 380, 260, 86, "P3  Indoor wayfinding\nQR anchor \u2192 position, "
          "Dijkstra route, live instruction", "process")
    f.box("p4", 660, 380, 260, 86, "P4  Logging &\nadministrative analytics\n"
          "date-ranged dashboard + CSV", "process")

    f.box("d1", 60, 580, 250, 70, "D1  Service corpus\nUpstash Vector \u2014 305 services",
          "store", rounded=False)
    f.box("d2", 345, 580, 250, 70, "D2  Floor layouts & office coords\nwf:mapstate + floor_presets",
          "store", rounded=False)
    f.box("d3", 630, 580, 250, 70, "D3  Query log\nwf:querylog", "store", rounded=False)
    f.box("d4", 915, 580, 205, 70, "D4  Navigation log\nwf:navlog", "store", rounded=False)

    f.box("priv", 60, 700, 1060, 54, "Logs are anonymous by construction: no name, IP or "
          "user agent is stored. The navigation session id is a random per-tab token used "
          "only to pair\na route start with its arrival, and does not persist across visits "
          "(RA 10173).", "group", dashed=True)

    f.edge("citizen", "p1", "F1 question (Taglish / English)")
    f.edge("p1", "p2", "F2 rewritten query")
    f.edge("p2", "groq", "F3 context + prompt")
    f.edge("groq", "p2", "F4 completion")
    f.edge("d1", "p2", "F5 candidate services")
    f.edge("p2", "citizen", "F6 answer + responsible office")
    f.edge("p2", "p3", "F7 office \u2192 destination cell")
    f.edge("citizen", "p3", "F8 QR scan / steps")
    f.edge("d2", "p3", "F9 walls, stairs, office coords")
    f.edge("p3", "citizen", "F10 route + live instruction")
    f.edge("p2", "d3", "F11 query, latency, dept")
    f.edge("p3", "d4", "F12 start / arrive / abandon")
    f.edge("d3", "p4", "F13 inquiries")
    f.edge("d4", "p4", "F14 completion + time on task")
    f.edge("p4", "admin", "F15 dashboard + CSV")
    f.edge("admin", "p5", "F16 room edits")
    f.edge("p5", "d2", "F17 published version")
    return f


if __name__ == "__main__":
    print("Redrawing against the deployed stack:\n")
    figure1().save()
    figure2().save()
    print("\nSources are editable in draw.io; the PNGs are rendered from the same spec.")
