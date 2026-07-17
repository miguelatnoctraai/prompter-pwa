# Prompter PWA

A personal MVP teleprompter PWA built with Vite + React + TypeScript + Tailwind CSS.

It shows a full-screen camera preview using `getUserMedia`, starts with the front-facing camera, and lets you flip between front and back cameras.

## Features

- Vite + React + TypeScript
- Tailwind CSS v4 via `@tailwindcss/vite`
- PWA support via `vite-plugin-pwa`
- Full-screen camera preview (`getUserMedia`)
- Front camera by default with a flip-camera button

## Getting started

```bash
# Clone the repo
git clone https://github.com/miguelatnoctraai/prompter-pwa.git

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open the printed local URL in your browser. On a mobile device, use the same network URL and make sure the page is served over HTTPS or `localhost` so the browser allows camera access.

## Build

```bash
npm run build
```

The production files are output to `dist/`.

## Cloud sync setup (optional)

The app works fully offline with scripts in `localStorage`. To enable accounts + cross-device sync (Supabase):

1. Create a free project at [supabase.com](https://supabase.com) (any project name, pick a region near you).
2. In the Supabase Dashboard, open **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Enable the email one-time code: **Authentication → Email Templates → Magic Link** — make sure the template body includes `{{ .Token }}` (the 6-digit code), e.g. add a line like `Your login code is {{ .Token }}`. The app uses codes instead of links because magic links open in Safari instead of the installed PWA on iOS.
4. Copy the **Project URL** and **anon public key** from **Project Settings → API** into a `.env.local` file (see [`.env.example`](.env.example)).
5. For the deployed app, add the same two variables in Vercel (**Project → Settings → Environment Variables**) and redeploy.

Without these env vars the build simply runs local-only and the Account screen says cloud sync is not configured.

How sync behaves: `localStorage` remains the source of truth, so the prompter never blocks on the network. Saves and deletes write through to the cloud when signed in; a full merge (last write wins per script) runs at sign-in and via **Sync now** on the Account screen.

## Notes

- Camera access requires a secure context (`localhost` or HTTPS).
- On iOS, use Safari and add to Home Screen for the standalone PWA experience.
- On Android, Chrome will prompt you to install the app.
