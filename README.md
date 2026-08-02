# 🍢 Celebrating Me - Event & Cookout Invitation Website

A responsive, interactive landing page for **MX's Birthday Cookout** at Trooditisa Picnic Site on **Saturday, August 8th**.

Built as a generic, reusable event template named **`celebrating-me`** for seamless hosting on **GitHub Pages**, with dynamic item pulling from `items.json` and real-time live guest sync.

---

## 🔒 Secrets & Config Setup (`config.json`)

To keep your JSONBin Bin ID and Master Key completely secret without committing them to GitHub:

1. Open `config.json` in your local project folder.
2. Put your secrets:
   ```json
   {
     "binId": "YOUR_JSONBIN_BIN_ID_HERE",
     "apiKey": "YOUR_JSONBIN_MASTER_KEY_HERE"
   }
   ```
3. `config.json` is listed in `.gitignore`, so git will **never commit or push your secrets to GitHub**.
4. When testing locally or configuring via the website UI button (`⚡ Live Sync & Settings`), the app automatically reads the secrets and syncs all guests in real time!

---

## 🚀 How to Publish to GitHub Pages

1. **Push the Repository**:
   ```bash
   cd /Users/mariaxenophontos/.gemini/antigravity/scratch/celebrating-me
   git init
   git add .
   git commit -m "Initial commit for Celebrating Me landing page"
   git branch -M main
   git remote add origin https://github.com/<your-username>/celebrating-me.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**:
   - Go to **Settings** > **Pages** in your GitHub repository.
   - Under **Source**, select `Deploy from a branch`.
   - Branch: `main` / Folder: `/ (root)`.
   - Click **Save**.
   - Your site will be live at `https://<your-username>.github.io/celebrating-me/`!
