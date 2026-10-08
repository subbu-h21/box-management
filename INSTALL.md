# Installing Box Dispatch on the shop computer

This guide is for the **main computer in the shop**: the one that stays on during working hours and has the printers connected. You only do this once. It takes about 30 minutes, most of it waiting.

**You need:**

- A Windows 10 or Windows 11 computer (64-bit).
- An internet connection while installing.
- The computer's administrator password, if it has one.

---

## Step 1: Install Git (a free download helper)

1. Open a web browser and go to **https://git-scm.com/download/win**
2. Click **"Click here to download"**. The download starts.
3. Open the downloaded file (it's named something like `Git-2.xx-64-bit.exe`).
4. If Windows asks *"Do you want to allow this app to make changes to your device?"*, click **Yes**.
5. Click **Next** on every screen (don't change anything), then **Install**, then **Finish**.

## Step 2: Download Box Dispatch

1. Press the **Windows key** on the keyboard, type **cmd**, and press **Enter**. A black window opens.
2. Copy this line exactly, then right-click inside the black window to paste it, and press **Enter**:

   ```
   git clone https://github.com/subbu-h21/box-management.git C:\BoxDispatch
   ```

3. Wait until the text stops moving and a blinking cursor comes back (under a minute). Then close the black window.

## Step 3: Run the setup

1. Open **File Explorer** (the yellow folder icon), click **This PC**, open **Local Disk (C:)**, then open the **BoxDispatch** folder.
2. Double-click **setup** (or **setup.bat**; it has a gear icon).
3. Windows asks *"Do you want to allow this app to make changes to your device?"*: click **Yes**. A new black window opens and starts installing.
   - If a blue box says *"Windows protected your PC"*, click **More info**, then **Run anyway**.
4. **Wait.** It downloads and installs everything it needs, which takes 5 to 20 minutes depending on the internet speed. Coloured lines show its progress.
5. It may ask: *"Is this the shop's own network? Set it to Private? (Y/N)"*. If the computer is on the **shop's own Wi-Fi or cable network**, type **Y** and press **Enter**. Without this, phones can't connect.
6. When it says **Setup finished**, find the line that says **"Phones on the shop Wi-Fi use:"** and **write down the address** shown, for example `192.168.1.20:8000`. Workers type this into the phone app.
7. Press any key to close the window.

> **If it says SETUP FAILED:** check the internet connection and run **setup** again. It's safe to run as many times as needed. If it still fails, send the file **setup-log.txt** from the BoxDispatch folder to the person who supports the app.

A **Box Dispatch** icon is now on the desktop.

## Step 4: Start Box Dispatch

1. Double-click the **Box Dispatch** icon on the desktop.
2. A black window opens (this is the app), plus a second small one in the taskbar (the **print agent**, which does the printing). After a few seconds the website opens in the browser.
3. **Keep both windows open all day.** You can minimize them, but **don't close them**: closing them stops the app and printing.
4. **Every morning**, after switching the computer on, double-click the **Box Dispatch** icon again.
5. At the end of the day, close both black windows (or just shut down the computer).

## Step 5: First-time settings (only once)

1. The website asks you to **create the admin account**. Fill in the name, username and password, and click **Create admin account**. **Remember this password**: the admin can add workers and see everything.
2. Open the **Printer** tab:
   - Under **Printer for dispatch lists & test pages**, choose the printer for the daily lists.
   - Click **Print test page** to check it prints.
3. Open the **Stickers** tab:
   - Under **Printer for stickers**, choose the sticker printer.
   - Print an **Alignment test** on plain paper and adjust the layout until the name lands in the right place on the sticker.
4. Open **Transporters & Shops** and add your transporters and medical shops.
5. Open **Users** to add workers. Workers can also register themselves from the login page, and the admin approves them in **Users**.

## Step 6: Install the app on workers' phones

The phone must be on the **shop's Wi-Fi**.

1. On the phone, open **Chrome** and type the address you wrote down in Step 3, for example `192.168.1.20:8000`.
2. Tap **Get the Android app**, then **Download**.
3. Open the downloaded file. If the phone asks, allow **Install unknown apps** for Chrome, then tap **Install**.
4. Open **Box Dispatch** on the phone. Enter:
   - **Server address**: the address from Step 3.
   - **Username** and **Password**.

   Tap **Log in**. The phone stays logged in for 30 days.

**Other computers in the shop** don't need any installation. Open a browser and type the same address.

---

## Updating to a new version

1. Close both Box Dispatch black windows.
2. Open the **BoxDispatch** folder (C: drive) and double-click **update** (or **update.bat**).
3. Wait until it says **Update finished**, then press any key.
4. Start Box Dispatch again from the desktop icon.

All your records stay as they are. If phones need the new app version, the website's **Android app** button offers it.

## Keep your data safe (backup)

All records are in one file: **C:\BoxDispatch\backend\data.db**

Once a week, **close Box Dispatch first**, then copy that file to a USB drive or Google Drive. If the computer breaks, that file holds everything.

Also keep a safe copy of the **mobile\credentials** folder, if your support person put one on this computer. It's needed to make app updates that phones accept.

## Good to know

- **Stop the computer from sleeping during the day.** Go to **Settings → System → Power & sleep** and set **Sleep** to **Never** (when plugged in). While it sleeps, phones and printing don't work.
- **The phone address can change** if the Wi-Fi router restarts and gives this computer a new address. If phones suddenly can't connect, check the address on the website (**Android app** button → "Server address to type in the app"). To stop it changing, ask whoever looks after your router to give this computer a **fixed (reserved) IP address**.

## Problems and fixes

| Problem | What to do |
|---|---|
| The website says *"This site can't be reached"* | Box Dispatch isn't running. Double-click the desktop icon. |
| Phones can't connect | Check that the main computer is on and the black windows are open, and the phone is on the shop Wi-Fi. Then check the address (see "Good to know" above). If it still fails, run **setup** again and answer **Y** to the Private network question. |
| Nothing prints | Open the **Printer** tab: it shows if the printer is offline or out of paper. Check that the small **print agent** window is open. |
| Forgot a worker's password | The admin opens **Users** and resets it. |
| Forgot the admin password | If there's a second admin, they can reset it. Otherwise contact your support person. |
