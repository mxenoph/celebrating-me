# 🍢 Celebrating Me - Event & Cookout Invitation Website

A responsive, interactive landing page for **MX's Birthday Cookout** at Trooditisa Picnic Site on **Saturday, August 8th**.

Built as a generic, reusable event template named **`celebrating-me`** for seamless hosting on **GitHub Pages**, with dynamic item pulling from `items.json` and RSVP saving into `rsvps.json`.

---

## 🌟 Key Features

1. **Hero Story & Atmosphere**:
   - Features the story of why MX is hosting a cookout where guests bring items as their gift.
   - Highlights the **Mandatory Water Bottle Rule** (each guest brings their own water in an insulated water bottle).
   - Live Countdown Timer to Saturday, August 8th.

2. **Interactive Item Claim List**:
   - Categorized into **Big Items (Pick 1)** and **Small Items (Pick 2)**.
   - Includes special notes (e.g. Pork BBQ Foukou note: *"As MX is bringing the meat she will be bringing it on skewers already, so we are using her bbq but whoever picks this will have to take the bbq back as afterwards MX is going camping"*).
   - **Pre-RSVP Check Gate**: Prompts guests to RSVP with their name before checking items off the list.
   - **Initials Badging**: Displays initials (e.g. `[MX]`) in the checkbox once claimed.
   - **Partial Claim Counter & Breakdown**: Next to each item, shows `Needed: X of Y`, quantity stepper dialog when clicked, and lists who is bringing how many (e.g. `MX: 2`, `2 still needed`).

3. **Data Source & Repository Sync**:
   - `items.json`: Easily updateable list of items, quantities, categories, and notes.
   - `rsvps.json`: Repository data file holding saved guest RSVPs and item claims.
   - **Host Export Tool**: Includes a discreet `⚙️ Data & Export (Host)` button at the bottom right to download the merged `rsvps.json` file in 1 click and commit it to git.

---

## 🚀 How to Publish to GitHub Pages

1. **Create a GitHub Repository**:
   - Create a new public repository on GitHub named **`celebrating-me`**.

2. **Push the Files**:
   ```bash
   cd /Users/mariaxenophontos/.gemini/antigravity/scratch/celebrating-me
   git init
   git add .
   git commit -m "Initial commit for Celebrating Me event landing page"
   git branch -M main
   git remote add origin https://github.com/<your-username>/celebrating-me.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**:
   - Go to **Settings** > **Pages** in your GitHub repository.
   - Under **Source**, select `Deploy from a branch`.
   - Branch: `main` / Folder: `/ (root)`.
   - Click **Save**.
   - Your site will be live at `https://<your-username>.github.io/celebrating-me/`!

---

## ⚙️ Reusing for Future Events (`items.json`)

To reuse this template for future celebrations or events:
1. Edit `items.json` to change the items list, quantities, or categories.
2. Clear or edit `rsvps.json` to reset guest responses.
3. Update `index.html` title and date as needed!
