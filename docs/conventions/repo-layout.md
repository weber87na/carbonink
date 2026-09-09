# Repo layout — monorepo

> Detailed reference for `AGENTS.md` → "Where things live". This file is linked,
> not auto-loaded; read it when you need the full monorepo picture.

This is an npm workspace. Two top-level apps share tooling + docs:

```
carbonink/
├── package.json              ← workspace root, monorepo scripts
├── package-lock.json         ← one lockfile for the complete workspace
├── docs/                     ← shared (specs, plans, release notes, conventions)
├── CLAUDE.md                 ← @AGENTS.md (the always-loaded conventions index)
├── desktop/                  ← Electron app (the user-facing v1)
│   ├── package.json          ← name: "carbonink"
│   ├── src/                  ← main, preload, renderer, shared
│   ├── tests/                ← vitest (932 passing as of 2026-05-29)
│   └── …                     ← electron-vite, electron-builder, paraglide
└── cloud/                    ← Cloudflare static marketing site
    └── web/                  ← @carbonink-cloud/web (Astro → Static Assets)
```

**Top-level scripts** (run from repo root):

```bash
npm run desktop:test      # vitest tests in desktop/
npm run desktop:typecheck # tsc --noEmit on desktop/
npm test                  # all workspaces with a test script
```

**Per-package scripts** still work through npm workspace selection:

```bash
npm run dev --workspace=carbonink          # electron-vite dev --watch (renderer HMR + main/preload hot-restart)
npm run build --workspace=@carbonink-cloud/web
```

**Why monorepo**: desktop + the marketing site share tooling, CI, and docs in
one place — a single PR can touch both apps atomically.

**Dependency lifecycle scripts** run under npm's default policy. This is
required by native/tooling dependencies including `better-sqlite3`, `electron`,
`esbuild`, `sharp`, and `workerd`. The former pnpm per-package `allowBuilds`
policy has no direct npm 11.8 equivalent, so review new dependencies that add
install scripts before accepting them.

**Brand identity is unified** across desktop + cloud — `--color-primary`
in `cloud/web/src/styles/global.css` is bound to the X2 mark's moss-green
accent (`#6B8266`), and the LogoMark/favicon are verbatim ports of the
desktop icon. Source of truth is `desktop/scripts/icon-designs.mjs`.
Full palette table + "don't reintroduce sky-blue" rule lives in
`cloud/CLAUDE.md` § "Brand palette".

**Electron pinned at `^41.5.1`** — not the latest. We can't move to v42
yet because `better-sqlite3` (latest 12.10.0) doesn't compile against
Electron 42's V8 14.8 API. The upstream fix
([better-sqlite3 PR #1475](https://github.com/WiseLibs/better-sqlite3/pull/1475))
is maintainer-approved but unmerged. Full investigation + re-attempt
checklist in `docs/research/2026-05-25-electron-42-upgrade-blocker.md`.
