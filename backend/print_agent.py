"""Print agent: runs on the PC that has the printer.

Every 2 seconds it asks the server for a waiting print job. For each job it
turns the page into an A4 PDF with Microsoft Edge (headless) and sends it to
the printer with SumatraPDF, without any dialog. Uses only the standard library.

Settings (environment variables, all optional):
  BOX_SERVER           server address            (default http://127.0.0.1:8000)
  BOX_PRINTER          printer name, used when a job has no printer chosen on the website
                       (default: the Windows default printer)
  BOX_EDGE             path to msedge.exe        (default: found automatically)
  BOX_SUMATRA          path to SumatraPDF.exe    (default: ../tools/SumatraPDF.exe)
  BOX_PRINT_TO_FOLDER  testing only: save PDFs in this folder instead of printing
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = os.environ.get("BOX_SERVER", "http://127.0.0.1:8000").rstrip("/")
TOKEN_FILE = HERE / "agent_token.txt"
SUMATRA = Path(os.environ.get("BOX_SUMATRA") or HERE.parent / "tools" / "SumatraPDF.exe")
PRINTER = os.environ.get("BOX_PRINTER", "").strip()
SAVE_TO_FOLDER = os.environ.get("BOX_PRINT_TO_FOLDER", "").strip()
EDGE_PROFILE = HERE / ".print-agent" / "edge-profile"  # separate from the user's own Edge

POLL_SECONDS = 2
PRINTER_CHECK_SECONDS = 30
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def log(msg: str) -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def find_edge() -> Path:
    candidates = [os.environ.get("BOX_EDGE", "")]
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
    for c in candidates:
        if c and Path(c).is_file():
            return Path(c)
    sys.exit("Microsoft Edge was not found. Set BOX_EDGE to the full path of msedge.exe.")


# ---------- Printer state ----------

# Win32_Printer.PrinterStatus: 3 idle, 4 printing, 5 warming up, 6 stopped, 7 offline
PS_QUERY = (
    "@(Get-CimInstance Win32_Printer | Select-Object Name, Default, WorkOffline, PrinterStatus) "
    "| ConvertTo-Json -Compress"
)
STATE_KEYS = ("printer", "printer_ok", "message")


def _judge(p: dict) -> tuple[bool, str]:
    """(ready?, problem) for one Win32_Printer entry."""
    if p.get("WorkOffline") or p.get("PrinterStatus") == 7:
        return False, "Printer is offline (switched off or unplugged?)"
    if p.get("PrinterStatus") == 6:
        return False, "Printer has stopped (paper jam or out of paper?)"
    return True, ""


def printer_state(wanted: str) -> dict:
    """State of the wanted printer ('' = Windows default), plus every installed printer and its state."""
    if SAVE_TO_FOLDER:
        name = f"Save to folder: {SAVE_TO_FOLDER}"
        msg = "Test mode: PDFs are saved, not printed"
        return {"printer": name, "printer_ok": True, "message": msg,
                "printers": [{"name": name, "ok": True, "message": msg}], "default_printer": name}
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", PS_QUERY],
            capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW,
        ).stdout.strip()
        found = json.loads(out) if out else []
    except (OSError, subprocess.TimeoutExpired, ValueError) as e:
        return {"printer": wanted or "?", "printer_ok": True, "message": f"Could not check printer state ({e})",
                "printers": None, "default_printer": ""}
    found = found if isinstance(found, list) else [found]
    printers = []
    for p in found:
        ok, msg = _judge(p)
        printers.append({"name": p["Name"], "ok": ok, "message": msg})
    state = {"printers": printers, "default_printer": next((p["Name"] for p in found if p.get("Default")), "")}
    if wanted:
        p = next((p for p in found if p["Name"] == wanted), None)
    else:
        p = next((p for p in found if p.get("Default")), None)
    if not p:
        msg = f"Printer '{wanted}' not found" if wanted else "No default printer is set"
        return {**state, "printer": wanted, "printer_ok": False, "message": msg}
    ok, msg = _judge(p)
    return {**state, "printer": p["Name"], "printer_ok": ok, "message": msg}


# ---------- Server ----------

def call(path: str, body: dict, token: str):
    req = urllib.request.Request(
        SERVER + path, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Agent-Token": token},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


# ---------- Printing ----------

def html_to_pdf(edge: Path, html: str, workdir: Path) -> Path:
    src, pdf = workdir / "page.html", workdir / "page.pdf"
    src.write_text(html, encoding="utf-8")
    subprocess.run(
        [str(edge), "--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer",
         f"--user-data-dir={EDGE_PROFILE}", f"--print-to-pdf={pdf}", src.as_uri()],
        capture_output=True, timeout=90, creationflags=NO_WINDOW,
    )
    if not pdf.is_file() or pdf.stat().st_size == 0:
        raise RuntimeError("Could not make the PDF (Edge failed)")
    return pdf


def send_to_printer(pdf: Path, printer: str, options: dict) -> None:
    # noscale: print at true size. Stickers also set the paper size (e.g. "100mm x 70mm") and tray.
    settings = ["noscale"]
    if options.get("paper"):
        settings.append(f"paper={options['paper']}")
    if options.get("tray"):
        settings.append(f"bin={options['tray']}")
    r = subprocess.run(
        [str(SUMATRA), "-print-to", printer, "-print-settings", ",".join(settings), "-silent", "-exit-when-done",
         str(pdf)],
        capture_output=True, timeout=180, creationflags=NO_WINDOW,
    )
    if r.returncode != 0:
        raise RuntimeError(f"SumatraPDF could not print (exit code {r.returncode})")


def handle(job: dict, edge: Path, printer: str) -> None:
    with tempfile.TemporaryDirectory(prefix="boxprint-") as tmp:
        pdf = html_to_pdf(edge, job["html"], Path(tmp))
        if SAVE_TO_FOLDER:
            dest = Path(SAVE_TO_FOLDER) / f"job-{job['id']}.pdf"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(pdf.read_bytes())
            log(f"  saved {dest}")
        else:
            send_to_printer(pdf, printer, job.get("options") or {})


def main() -> None:
    edge = find_edge()
    if not SAVE_TO_FOLDER and not SUMATRA.is_file():
        sys.exit(f"SumatraPDF not found at {SUMATRA}. Set BOX_SUMATRA to its full path.")
    EDGE_PROFILE.mkdir(parents=True, exist_ok=True)
    log(f"Print agent started. Server: {SERVER}")

    token = None
    chosen = ""  # printer chosen for dispatch lists on the Printer page ('' = none chosen); shown as its status
    state, state_at = None, 0.0
    server_down = False
    while True:
        try:
            if token is None:
                if not TOKEN_FILE.is_file():
                    log("Waiting for the server to create agent_token.txt (is the server running?)")
                    time.sleep(5)
                    continue
                token = TOKEN_FILE.read_text(encoding="utf-8").strip()

            if state is None or time.monotonic() - state_at > PRINTER_CHECK_SECONDS:
                new_state = printer_state(chosen or PRINTER)
                if state is None or [new_state[k] for k in STATE_KEYS] != [state[k] for k in STATE_KEYS]:
                    log(f"Printer: {new_state['printer'] or '-'} | "
                        f"{'ready' if new_state['printer_ok'] else 'NOT READY'} {new_state['message']}")
                state, state_at = new_state, time.monotonic()
                body = state  # also sends the list of installed printers
            else:
                body = {k: state[k] for k in STATE_KEYS}

            res = call("/api/agent/claim", body, token)
            if server_down:
                log("Server reachable again")
                server_down = False
            if res.get("printer", "") != chosen:
                chosen = res.get("printer", "")
                log(f"Printer chosen for lists on the website: {chosen or '(none: using default)'}")
                state = None  # check the newly chosen printer right away
            job = res.get("job")
            if not job:
                time.sleep(POLL_SECONDS)
                continue

            # Each job goes to the printer chosen for it on the website (stickers and lists can differ).
            target = job.get("printer") or PRINTER
            log(f"Job {job['id']}: {job['title']} -> {target or '(Windows default printer)'}")
            job_state = printer_state(target)  # fresh check of exactly this printer
            printer = job_state["printer"]
            if not job_state["printer_ok"]:
                call(f"/api/agent/jobs/{job['id']}/finish",
                     {"ok": False, "error": job_state["message"], "printer": printer}, token)
                log(f"  not printed: {job_state['message']}")
                continue
            try:
                handle(job, edge, printer)
                call(f"/api/agent/jobs/{job['id']}/finish", {"ok": True, "printer": printer}, token)
                log(f"  printed on {printer}")
            except Exception as e:  # report any failure back so the person isn't left waiting
                call(f"/api/agent/jobs/{job['id']}/finish", {"ok": False, "error": str(e), "printer": printer}, token)
                log(f"  FAILED: {e}")

        except urllib.error.HTTPError as e:
            if e.code == 401:
                log("Server rejected the agent token; reloading agent_token.txt")
                token = None
            else:
                log(f"Server error {e.code}")
            time.sleep(5)
        except (urllib.error.URLError, OSError) as e:
            if not server_down:
                log(f"Server not reachable ({e}); retrying…")
                server_down = True
            time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Print agent stopped")
