"""HTML pages that the print agent turns into A4 PDFs (via Edge) and prints."""
from html import escape

DISPATCH_CSS = """
@page { size: A4; margin: 14mm 12mm 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 11pt; }
.sheet { break-after: page; }
.sheet:last-child { break-after: auto; }
.head { display: flex; justify-content: space-between; align-items: flex-end;
        border-bottom: 0.6mm solid #000; padding-bottom: 2mm; margin-bottom: 4mm; }
.head h1 { margin: 0; font-size: 18pt; }
.head h1 .name { font-weight: 400; }
.head .date { font-size: 12pt; font-weight: 700; text-align: right; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 0.25mm solid #999; padding: 2.2mm 2mm; text-align: left; vertical-align: top; }
th { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 0.4mm solid #000; }
thead { display: table-header-group; }  /* repeat column headings on every page */
tr { break-inside: avoid; }
.n { width: 10mm; }
.num { text-align: right; width: 20mm; font-size: 12pt; }
th.num { font-size: 9.5pt; }
.area { color: #444; }
.remark { font-weight: 700; margin-top: 1mm; }
tfoot td { border-bottom: 0; border-top: 0.5mm solid #000; font-weight: 700; font-size: 12pt; }
.foot { margin-top: 6mm; font-size: 9pt; color: #444; }
"""


def _sheet(d: dict, printed_by: str, printed_at: str) -> str:
    rows = []
    for n, i in enumerate(d["items"], 1):
        area = f' <span class="area">— {escape(i["shop_area"])}</span>' if i["shop_area"] else ""
        remark = f'<div class="remark">{escape(i["remarks"])}</div>' if i["remarks"] else ""
        rows.append(
            f'<tr><td class="n">{n}</td><td>{escape(i["shop_name"])}{area}{remark}</td>'
            f'<td class="num">{i["boxes"]}</td><td class="num">{i["carry_bags"]}</td></tr>'
        )
    y, m, day = d["date"].split("-")
    return f"""
<section class="sheet">
  <div class="head">
    <h1>{escape(d["transporter_code"])} <span class="name">— {escape(d["transporter_name"])}</span></h1>
    <div class="date">Dispatch list<br>{day}/{m}/{y}</div>
  </div>
  <table>
    <thead><tr><th class="n">#</th><th>Medical shop</th><th class="num">Boxes</th><th class="num">Bags</th></tr></thead>
    <tbody>{''.join(rows)}</tbody>
    <tfoot><tr><td></td><td>Total ({len(d["items"])} shops)</td>
      <td class="num">{d["total_boxes"]}</td><td class="num">{d["total_bags"]}</td></tr></tfoot>
  </table>
  <div class="foot">Printed by {escape(printed_by)} on {escape(printed_at)}</div>
</section>"""


def dispatch_pages_html(dispatches: list[dict], printed_by: str, printed_at: str) -> str:
    """One A4 page (or more, if long) per transporter."""
    sheets = "".join(_sheet(d, printed_by, printed_at) for d in dispatches)
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>Dispatch list</title>'
            f"<style>{DISPATCH_CSS}</style></head><body>{sheets}</body></html>")


TEST_CSS = """
@page { size: A4; margin: 0; }
html, body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
.page { position: relative; width: 210mm; height: 297mm; }
.body { position: absolute; left: 20mm; right: 20mm; top: 22mm; }
.body p { margin: 0 0 2.5mm; font-size: 12pt; overflow-wrap: anywhere; }
.body h1 { margin: 0 0 6mm; font-size: 24pt; }
.ruler { position: relative; width: 100mm; height: 50mm; border: 0.3mm solid #000; margin-top: 8mm; }
.ruler span { position: absolute; bottom: -6mm; font-size: 9pt; }
.corner { position: absolute; width: 10mm; height: 10mm; border: 0.3mm solid #000; }
"""


def test_page_html(printer: str, printed_by: str, printed_at: str) -> str:
    """Checks the printer works and prints at true size (the box must measure 100 x 50 mm)."""
    corners = "".join(
        f'<div class="corner" style="{pos}"></div>'
        for pos in ("left:5mm;top:5mm", "right:5mm;top:5mm", "left:5mm;bottom:5mm", "right:5mm;bottom:5mm")
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Test page</title>
<style>{TEST_CSS}</style></head><body><div class="page">{corners}
<div class="body">
  <h1>Box Dispatch — printer test page</h1>
  <p>Printer: {escape(printer)}</p>
  <p>Requested by {escape(printed_by)} on {escape(printed_at)}</p>
  <p>The box below should measure exactly 100 mm × 50 mm with a ruler.
  If it doesn't, the printer is scaling the page.</p>
  <div class="ruler"><span style="left:0">0</span><span style="right:0">100 mm</span></div>
</div>
</div></body></html>"""


# ---------- Glass-with-care stickers ----------
# Only the medical shop's name (after "To,") is printed; the sticker itself is already printed.

PAPER_MM = {"A4": (210, 297), "A5": (148, 210), "A6": (105, 148), "letter": (215.9, 279.4)}

# Shrink text until it fits its box. The website preview uses the same steps.
FIT_SCRIPT = """
for (const el of document.querySelectorAll('[data-fit]')) {
  let size = parseFloat(el.dataset.size);
  while ((el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5) && size > 4) {
    size -= 0.5;
    el.style.fontSize = size + 'pt';
  }
}
"""


def paper_size_mm(sticker: dict) -> tuple[float, float]:
    if sticker["paper"] == "sticker":
        return sticker["width_mm"], sticker["height_mm"]
    return PAPER_MM[sticker["paper"]]


def print_options(sticker: dict) -> dict:
    """SumatraPDF settings for printing on the sticker."""
    if sticker["paper"] == "sticker":
        paper = f"{sticker['width_mm']:g}mm x {sticker['height_mm']:g}mm"
    else:
        paper = sticker["paper"]
    return {"paper": paper, "tray": sticker["tray"]}


def _name_box(name: str, layout: dict, ox: float, oy: float, outline: bool = False) -> str:
    justify = {"left": "flex-start", "center": "center", "right": "flex-end"}[layout["align"]]
    style = (
        f"left:{ox + layout['x_mm']}mm; top:{oy + layout['y_mm']}mm; "
        f"width:{layout['width_mm']}mm; height:{layout['height_mm']}mm; "
        f"font-family:'{layout['font_family']}', Arial, sans-serif; font-size:{layout['font_size_pt']}pt; "
        f"font-weight:{700 if layout['bold'] else 400}; justify-content:{justify}; text-align:{layout['align']};"
        + (" outline: 0.2mm dotted #888;" if outline else "")
    )
    fit = f' data-fit data-size="{layout["font_size_pt"]}"' if layout["shrink_to_fit"] else ""
    return f'<div class="name" style="{style}"{fit}>{escape(name)}</div>'


def _sticker_doc(paper_w: float, paper_h: float, pages: str) -> str:
    css = f"""
@page {{ size: {paper_w}mm {paper_h}mm; margin: 0; }}
html, body {{ margin: 0; }}
.page {{ position: relative; width: {paper_w}mm; height: {paper_h}mm; overflow: hidden; break-after: page; }}
.page:last-child {{ break-after: auto; }}
.name {{ position: absolute; display: flex; align-items: center; line-height: 1.15;
         overflow: hidden; overflow-wrap: anywhere; color: #000; }}
.outline {{ position: absolute; border: 0.25mm dashed #000; box-sizing: border-box; }}
.note {{ position: absolute; font: 9pt Arial, sans-serif; color: #333; }}
"""
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>Stickers</title><style>{css}</style>'
            f"</head><body>{pages}<script>{FIT_SCRIPT}</script></body></html>")


def sticker_pages_html(name: str, layout: dict, sticker: dict, copies: int) -> str:
    paper_w, paper_h = paper_size_mm(sticker)
    page = f'<div class="page">{_name_box(name, layout, sticker["offset_x_mm"], sticker["offset_y_mm"])}</div>'
    return _sticker_doc(paper_w, paper_h, page * copies)


def sticker_test_html(name: str, layout: dict, sticker: dict) -> str:
    """Plain-paper test: sticker outline + the name, to hold a real sticker against."""
    paper_w, paper_h = paper_size_mm(sticker)
    ox, oy = sticker["offset_x_mm"], sticker["offset_y_mm"]
    outline = (f'<div class="outline" style="left:{ox}mm; top:{oy}mm; '
               f'width:{sticker["width_mm"]}mm; height:{sticker["height_mm"]}mm"></div>')
    note = ""
    if paper_h - (oy + sticker["height_mm"]) > 15:  # room below the sticker for instructions
        note = (f'<div class="note" style="left:{ox}mm; top:{oy + sticker["height_mm"] + 4}mm; width:{paper_w - ox - 5}mm">'
                "Alignment test: hold a blank sticker over the dashed outline. If the name is not where you "
                "want it on the sticker, move it on the Stickers page; if the whole print is shifted, "
                "change the fine adjustment in Sticker setup.</div>")
    page = f'<div class="page">{outline}{_name_box(name, layout, ox, oy, outline=True)}{note}</div>'
    return _sticker_doc(paper_w, paper_h, page)


def render_job(payload: dict, printer: str, printed_by: str, printed_at: str) -> str:
    """Build the page for a print job from its saved payload."""
    kind = payload["kind"]
    # Sticker jobs made before suppliers were replaced by shops stored the name as "supplier".
    name = payload.get("name") or payload.get("supplier", "")
    if kind == "test":
        return test_page_html(printer, printed_by, printed_at)
    if kind == "stickers":
        return sticker_pages_html(name, payload["layout"], payload["sticker"], payload["copies"])
    if kind == "sticker_test":
        return sticker_test_html(name, payload["layout"], payload["sticker"])
    return dispatch_pages_html(payload["dispatches"], printed_by, printed_at)


def job_print_options(payload: dict) -> dict:
    """Extra printer settings for the agent (paper size, tray); empty = printer defaults."""
    if payload.get("kind") in ("stickers", "sticker_test"):
        return print_options(payload["sticker"])
    return {}
