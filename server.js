require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

// Simple health check (per deployment best practice)
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// Direct GitHub REST API fetch for the "Load from GitHub" feature.
// (Swapped out the Swytchcode CLI shell-out for this — the CLI has to be
// installed separately on every machine/server that runs this app, which
// breaks on Render since it's not part of the deployed image. This plain
// fetch() needs nothing extra to work.)
// Optional: set GITHUB_TOKEN in .env to raise GitHub's rate limit and allow
// fetching from private repos you have access to.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

app.post("/api/github-fetch", async (req, res) => {
  try {
    const { owner, repo } = req.body;
    if (!owner || !repo) {
      return res.status(400).json({ error: "owner and repo are required" });
    }

    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "deploydoc-ai",
    };
    if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;

    // Try package.json first, then requirements.txt.
    const candidates = ["package.json", "requirements.txt"];
    let found = null;

    for (const path of candidates) {
      const ghRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        { headers }
      );
      if (ghRes.ok) {
        const data = await ghRes.json();
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        found = { path, content };
        break;
      }
      if (ghRes.status !== 404) {
        const errText = await ghRes.text();
        return res.status(ghRes.status).json({
          error: `GitHub API error (${ghRes.status})`,
          detail: errText,
        });
      }
    }

    if (!found) {
      return res.status(404).json({
        error: `Couldn't find package.json or requirements.txt in ${owner}/${repo}. Check the repo name and that it's public.`,
      });
    }

    res.json({ path: found.path, content: found.content });
  } catch (err) {
    console.error("github-fetch failed:", err);
    res.status(500).json({ error: "GitHub fetch failed: " + err.message });
  }
});

const SYSTEM_PROMPT = `You are an AI DevOps & Deployment Assistant.
You analyze repository info (package.json / requirements.txt / file listing / description) and optional build or deploy error logs, then produce deployment-ready output.

Rules:
- Infer language, framework, package manager, build command, start command from what's given.
- If the runtime version is not explicitly stated, say so instead of guessing a patch version, and recommend pinning it.
- Never invent secrets or real API keys - use placeholders like <your-api-key>.
- Keep the Dockerfile production-appropriate (multi-stage if it meaningfully helps, non-root user, only needed files).
- Only include a health check recommendation if the app is a long-running server (not for static sites/serverless).
- Respond with STRICT JSON ONLY, no markdown fences, no prose outside the JSON. Match this exact shape:

{
  "summary": "2-3 sentence plain-English summary of the project and its deployment posture",
  "rootCause": "if an error log was given, the most likely root cause. Empty string if no error log given.",
  "fix": "if an error log was given, the smallest practical fix with exact commands. Empty string if no error log given.",
  "dockerfile": "full Dockerfile contents as a string",
  "dockerignore": "full .dockerignore contents as a string",
  "githubActionsWorkflow": "full .github/workflows/deploy.yml contents as a string",
  "platformConfig": {
    "platform": "the target platform given by the user (render/vercel/netlify/docker/generic)",
    "filename": "e.g. render.yaml, vercel.json, netlify.toml, or 'N/A' for generic docker",
    "contents": "full file contents as a string, or empty string if not applicable"
  },
  "envVars": [ { "name": "DATABASE_URL", "required": true, "note": "why it's needed" } ],
  "checklist": [ { "item": "Production start command exists", "status": "ok | missing | warning", "note": "short explanation" } ],
  "rollback": "platform-appropriate rollback guidance, 2-3 sentences"
}`;

app.post("/api/analyze", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not set on the server. Add it to your .env file.",
      });
    }

    const { repoInfo, errorLog, platform } = req.body;

    if (!repoInfo || !repoInfo.trim()) {
      return res.status(400).json({ error: "repoInfo is required (paste package.json, requirements.txt, or describe your stack)." });
    }

    const userPrompt = `
TARGET PLATFORM: ${platform || "generic docker"}

REPOSITORY INFO:
${repoInfo}

BUILD/DEPLOY ERROR LOG (may be empty):
${errorLog || "(none provided)"}
`.trim();

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      return res.status(502).json({ error: `Gemini API error (${geminiRes.status}). Check your GEMINI_API_KEY and model name.` });
    }

    const data = await geminiRes.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse model JSON:", raw);
      return res.status(502).json({ error: "The model returned invalid JSON. Try again." });
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AI DevOps Assistant running at http://localhost:${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY not set. Copy .env.example to .env and add your key.");
  }
});
