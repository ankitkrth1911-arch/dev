# DeployDoc AI — AI DevOps & Deployment Assistant

Paste your repo info (and an optional error log) → get a Dockerfile,
GitHub Actions workflow, platform config (Render/Vercel/Netlify), an
env var checklist, and a deployment readiness checklist. Built for the
GDG Hackathon "AI DevOps & Deployment Assistant" track.

## 1. Setup (2 min)

```bash
npm install
cp .env.example .env
```

Open `.env` and paste your Gemini key (free at https://aistudio.google.com/apikey):

```
GEMINI_API_KEY=your_real_key_here
```

## 2. Run (30 sec)

```bash
npm start
```

Open **http://localhost:3000**

## 3. Demo script for judges (2 min)

1. Select platform → **Docker**.
2. Paste this into "Repo info":
   ```
   Node 18, Express API, package.json:
   { "scripts": { "start": "node server.js" }, "dependencies": { "express": "^4.19.2" } }
   ```
3. Click **Analyze & Generate** → show the generated Dockerfile,
   GitHub Actions workflow, and checklist appearing live.
4. Now paste a broken build log into the error log box (e.g.
   `Error: Cannot find module 'express'`) and re-run → show the
   **Root Cause + Fix** section appear — this is the "diagnose failed
   deploys" half of the track.
5. Switch platform to **Render** and re-run → show `render.yaml` in
   the Platform Config tab regenerate for the new target.

That covers all three angles of the track: **analysis → diagnosis →
generated deployment config**, in one flow.

## How it works

- `server.js` — Express backend, single `/api/analyze` endpoint that
  sends your repo info + error log to Gemini (2.0 Flash) with a
  strict-JSON system prompt (`responseMimeType: application/json`) and
  returns structured deployment output.
- `public/index.html` — single-page UI (Tailwind CDN, no build step)
  with tabs for Dockerfile / CI-CD / Platform Config / Env Vars / Checklist.
- No database, no auth — intentionally minimal for a 2-hour build.

## If you have extra time

- Persist past analyses in-memory so judges can flip through history.
- Add a live "deploy readiness score" (% of checklist items passing)
  as a big number on the results screen — very demo-friendly.

## Optional: Swytchcode integration (GitHub fetch)

The "Load from GitHub" button calls `/api/swytch-exec`, which shells out
to the Swytchcode CLI instead of hand-rolling a GitHub API fetch. Set it
up once, in the project root:

```bash
# 1. Install the CLI
# mac/Linux:
curl -fsSL https://cli.swytchcode.com/install.sh | sh
# Windows:
irm https://cli.swytchcode.com/install.ps1 | iex

# 2. Confirm it installed
swytchcode -v

# 3. Initialize in this project (creates .swytchcode/tooling.json)
swytchcode init

# 4. Pull the GitHub integration manifest
swytchcode get github

# 5. Find the exact canonical ID for "get file contents"
swytchcode list methods github
# (server.js currently assumes it's `github.repos.getContent` —
#  update the toolId in public/index.html's loadFromGithub() if the
#  real ID differs)

# 6. Register it so the CLI enforces its schema at runtime
swytchcode add github.repos.getContent

# 7. Test it directly in the terminal BEFORE relying on the app button
swytchcode exec github.repos.getContent --owner expressjs --repo express --path package.json
```

If step 7 doesn't work from the terminal, the app button won't work
either — debug it there first, it's much faster than debugging through
the browser. You'll also need a GitHub token available (the CLI will
prompt you for one on first real — non-demo — execution).

**Given your time budget:** this is the riskiest part of the build
since it depends on an external CLI you likely haven't used before and
its npm wrapper package (`swytchcode-runtime`) is currently unpublished.
If steps 1–7 aren't working within ~10 minutes, fall back to a plain
`fetch()` call to the GitHub REST API in `loadFromGithub()` — same user
experience, zero external dependency risk.
