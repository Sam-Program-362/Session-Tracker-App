# Session Tracker

Session Tracker is a mobile-first, local-first time tracker. It works offline and saves device data in IndexedDB. It now also supports optional accounts and cross-device sync with Better Auth, Neon Postgres, and Drizzle ORM.

## What is included

- Work, Study, Hobby, Ideas, and permanent custom categories
- Timestamp-based stopwatch that stays correct when the phone locks
- Notes, reusable category task lists, summaries, and day-based logs
- PWA manifest, icons, service worker, and offline app shell
- Email/password accounts through Better Auth
- UUID records with `createdAt`, `updatedAt`, and soft deletes
- Local-first sync using newest `updatedAt` wins
- Running sessions never leave their device until they are closed
- Every server read and write is scoped to the signed-in user

## Run locally

```bash
npm install
npm run dev
```

For a production check:

```bash
npm run build
```

## Database setup

Copy `.env.example` to `.env.local` and fill in the values. Never commit `.env.local`.

```bash
npm run db:generate
npm run db:migrate
```

The migration command needs `DATABASE_URL` to point to your Neon database.

## Deploying to Vercel, step by step

1. Go to **vercel.com** and select **Log In**.
2. Select **Add New...** then **Project**.
3. Find `Sam-Program-362/Session-Tracker-App` and select **Import**.
4. Keep the detected framework as **Next.js**.
5. Open **Environment Variables** and add these three names and values:
   - `DATABASE_URL`: paste the Neon connection string.
   - `BETTER_AUTH_SECRET`: paste a long random secret. Do not share it.
   - `BETTER_AUTH_URL`: paste the Vercel production URL, for example `https://your-project.vercel.app`.
6. Select **Deploy**.
7. In the Vercel project, open **Settings**, then **Domains**, and copy the real project URL.
8. Replace `BETTER_AUTH_URL` with that exact URL if it changed, then select **Save**.
9. In Vercel, open **Deployments**, open the newest deployment, select the three-dot menu, and select **Redeploy**.

Before the first Vercel deployment, create a Neon project at **neon.tech**, select **Connect**, copy its connection string, and use it for `DATABASE_URL`. Run `npm run db:migrate` locally with that value first, or run the migration from a machine where Node and npm are installed.

## Test sync

1. Open the app while signed in on Device A.
2. Turn off internet, start and close a session, then turn internet back on.
3. Wait until Settings says **Synced**.
4. Open the same account on another browser or device and confirm the session appears.
5. Change a synced record on the other device, then return to Device A while online. The newer `updatedAt` value wins.

No pull request is created or merged by this project workflow.
