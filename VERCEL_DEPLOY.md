# Deploy Session Tracker to Vercel (non-coder steps)

This app is a Next.js app with a `build` script that outputs static files. Vercel can deploy it directly from the GitHub repo you just pushed to.

You only need a free Vercel account. You do **not** need to install Node, Git, or anything on your computer for this part.

---

## 1. Sign in to Vercel with GitHub

1. Open https://vercel.com
2. Click **Sign Up**.
3. Click the **Continue with GitHub** button.
4. Authorize Vercel when GitHub asks.

---

## 2. Import the GitHub repo

1. After signup, Vercel usually shows a screen that says something like **"Import Git Repository"**. If you see a button that says **Add New...**, click it, then choose **Project**.
2. You should see a list of your GitHub repos. Find **Session-Tracker-App** and click it.
   - If you do not see it, click the button labeled **Import Git Repository** (or **Import Existing Project**), then click **GitHub**, then click **Select GitHub Repository**, and pick **Session-Tracker-App**.
3. On the import screen, leave these settings as they are unless a field is clearly empty:
   - **Framework Preset**: should say **Next.js**
   - **Build Command**: should already be `next build`
   - **Output Directory**: leave it empty
   - **Install Command**: leave it as the default
4. Scroll to the bottom of the page and click **Deploy**.

---

## 3. Wait for the first deploy

1. You will be taken to a deploy screen. You should see a progress line and a status that changes from **Building** to **Ready**.
2. When the deploy finishes, the status will say **Ready** and you will see a URL that looks like:
   `https://session-tracker-app-<random-letters>.vercel.app`
3. Click that URL to open the live app.

---

## 4. How to redeploy after future changes

Every time you push new commits to the `main` branch on GitHub, Vercel deploys again automatically. You do not need to do anything in Vercel for normal updates.

If you ever need to trigger a deploy manually:

1. In Vercel, open the **Session Tracker** project.
2. Click the tab labeled **Deployments**.
3. Click the button labeled **Redeploy** on the most recent deploy.

---

## 5. If the deploy fails

1. In Vercel, open the project.
2. Click **Deployments**.
3. Click the failed deploy.
4. Scroll down to **Build Logs** and read the last few lines. The most common fix is that the repo is missing a commit, or the `build` command changed. If you pushed the commit in this guide, the deploy should work as-is.

---

## Notes

- This app does not use a backend server, database, or API keys, so you do not need to add any environment variables in Vercel.
- The app is a PWA: on a phone, you can tap **Share** in the browser and choose **Add to Home Screen** to install it. The app icons and manifest are included.
- The service worker is included, so after the first load the app can open even when offline.
