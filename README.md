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

## Notes

- Camera access requires a secure context (`localhost` or HTTPS).
- On iOS, use Safari and add to Home Screen for the standalone PWA experience.
- On Android, Chrome will prompt you to install the app.
