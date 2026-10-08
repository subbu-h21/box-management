# Box Dispatch

Records how many boxes go to each medical shop through each transporter, one record per transporter per day.

- `backend/`: FastAPI + SQLite (`backend/data.db`, created on first start)
- `frontend/`: React + Vite

## Quick start (Windows)

Double-click `start.bat`. On the first run it sets up Python and Node packages, then it builds the frontend, starts the server and opens http://localhost:8000. Close the window or press Ctrl+C to stop.

## First-time setup (manual)

```sh
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt

cd ../frontend
npm install
```

### Dummy data (optional)

```sh
cd backend
.venv\Scripts\python seed.py           # only runs if the database is empty
.venv\Scripts\python seed.py --reset   # deletes ALL data, then reseeds
```

## Run (normal use)

```sh
cd frontend && npm run build
cd ../backend && .venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. Other PCs on the same network can use http://<this-pc-ip>:8000.

## Run (development, with hot reload)

```sh
cd backend && .venv\Scripts\python -m uvicorn main:app --reload --port 8000
cd frontend && npm run dev     # http://localhost:5173, proxies /api to :8000
```

## Logins and roles

- **First start:** if there are no accounts, the website asks you to create the admin account.
- **New workers:** can click "New worker? Register" on the login page (name, phone, username, password). They can't log in until an admin approves them in the Users tab, which shows a count of pending requests. Rejecting removes the request.
- **Admin:** everything, plus History, Activity (who did what, boxes per worker), Users (add / approve / disable / reset password), and deleting transporters, shops and dispatch records.
- **Worker:** New Entry, today's Daily List, and adding/editing transporters and shops. No deletes, no history.
- **Website:** logged out after 30 minutes without activity. An unsaved list is saved automatically first. If the browser was closed instead, the list is offered back ("Restore") when the same person logs in again that day.
- **Mobile app (future):** `POST /api/auth/login` with `"client": "mobile"` returns a `token`. Send it as `Authorization: Bearer <token>`. It stays valid for 30 days from login, or until `POST /api/auth/logout`.
- **Dummy data:** `seed.py` creates `admin / admin123` and workers `ravi`, `suresh`, `meena` with password `worker123`.

Every change is recorded in the activity log. Boxes are credited per change: if one worker enters 10 boxes and another changes it to 12, the first gets +10 and the second +2. If two people edit the same list at the same time, the second save is refused instead of silently overwriting the first.

Settings (environment variables): `BOX_IDLE_MINUTES` (default 30), `BOX_DB` (database file path).

## Printing

The printer is connected to the main PC (the one running the server). Anyone can press **Print** on a phone or any PC, and the list prints on that printer.

- **Print** and **Print all** send the job to a queue. The print agent (`backend/print_agent.py`, started by `start.bat` in its own minimized window) picks it up, turns it into an A4 PDF with Microsoft Edge, and prints it silently with SumatraPDF (`tools/SumatraPDF.exe`) on the **Windows default printer**. "Print all" puts each transporter on its own page.
- **Print here** / **Print all here** use the browser's own print dialog on the device you are using.
- The Daily List shows the printer state ("Printer ready", "Printer PC offline", "Printer problem") and each job's progress. If the agent isn't running, jobs wait, and the person can cancel them.
- **Printer tab** (everyone):
  - Status of the printer PC and printer.
  - **Print test page**, with a 100 × 50 mm box to check the printer prints at true size.
  - **Printer for dispatch lists & test pages**: pick any printer installed on the main PC, or the Windows default. It shows who changed it last.
  - The **printer for stickers** is chosen separately, on the Stickers page. Both dropdowns list every printer the print agent finds on the main PC, with its ready/offline state.
  - Each print job goes to the printer chosen for its kind at the moment Print is pressed.
  - **Print history**: filter by date, status or "only mine"; cancel waiting jobs or **Print again**.
- **Agent settings** (environment variables): `BOX_PRINTER` (used when no printer is chosen on the Printer tab), `BOX_SERVER`, `BOX_EDGE`, `BOX_SUMATRA`, and `BOX_PRINT_TO_FOLDER` (testing: save PDFs instead of printing).

## Glass-with-care stickers

The stickers are pre-printed. Only the **medical shop's name** is printed, after "To,", onto a blank sticker fed into the printer.

- **Stickers tab:**
  - Pick a medical shop (fuzzy search), set the number of copies, and press **Print**.
  - **Alignment test** prints the sticker outline and the name on plain paper, to hold a real sticker against.
  - **Layout:** drag the name box in the preview to move it, or drag its corner to resize it. You can also type exact values in mm, and choose the font, size, bold, alignment and "shrink long names to fit".
  - **Standard layout** is used by every shop; any shop can have **its own layout** (e.g. a very long name).
- **Sticker setup** (on the same tab):
  - Sticker width × height.
  - Paper size to tell the printer: "same as the sticker" (a custom size) or A4 / A5 / A6 / Letter.
  - Where the sticker sits on that paper, or a fine shift in mm.
  - Printer tray (optional).
  - Which printer stickers print on ("Printer for stickers", right under the Print button).
  - Optional photo of the blank sticker for the preview. A built-in photo of the Kapila Pharma sticker is used otherwise. It is never printed.
- The default size (150 × 103 mm) is an assumption until the real sticker is measured.

## Android app

`mobile/` is an Expo (React Native) app for workers and admins. It has the same features as the website, laid out for phones, except the sticker layout editor and sticker setup, which stay on the website. It talks to the server on the main PC over the shop Wi-Fi.

- **Installing on phones:** on the website, click **Android app** (top bar, or "Get the Android app" on the login page). It offers the APK download, shows the **server address** to type into the app (e.g. `192.168.1.20:8000`), and has install steps.
- **Logging in:** the app asks for the server address, username and password. It remembers the server and stays logged in for 30 days (or until Log out). New workers can **Register** from the app.
- **Building a new APK** (on this PC; needs Android SDK + Java 17):
  ```sh
  cd mobile
  npm run build:apk        # -> downloads/box-dispatch.apk, served by the website
  ```
  Before building an update, raise `version` and `android.versionCode` in `mobile/app.json`.
- **Signing key:** `mobile/credentials/` holds the app's release signing key. **Back it up.** Phones only accept an update signed with the same key, so if it's lost, everyone has to uninstall and reinstall the app.
- **Firewall:** phones must be able to reach port 8000 on the main PC.
  1. Mark the shop Wi-Fi as a **Private** network on the main PC: Settings → Network & internet → Wi-Fi (or Ethernet) → the network → **Private network**. Windows blocks incoming connections on Public networks.
  2. Allow the port once, in an admin PowerShell:
  ```powershell
  New-NetFirewallRule -DisplayName "Box Dispatch" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
  ```
- **Building is heavy:** a first APK build takes about 10 minutes and a lot of memory. Close other big programs (and any Android emulator) while it runs. The build works in `C:\bdb\mobile`, a copy made because the Android C++ tools can't handle this project's long folder path.

## Backup

All data is in `backend/data.db`. Stop the server before copying it, or copy `data.db`, `data.db-wal` and `data.db-shm` together.
