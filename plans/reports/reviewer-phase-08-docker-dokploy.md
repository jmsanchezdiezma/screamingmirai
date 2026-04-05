# Code Review: Phase 8 -- Docker & Dokploy Deployment

**Reviewer:** code-reviewer agent
**Date:** 2026-04-05
**Scope:** Phase 8 implementation (Dockerfile, docker-compose.yml, .dockerignore, health endpoint, CI/CD workflows)

## Scope

- Files: `Dockerfile` (69 lines), `docker-compose.yml` (26 lines), `.dockerignore` (13 lines), `app/api/health/route.ts` (12 lines), `.github/workflows/docker.yml` (52 lines)
- LOC: 172 total across 5 files
- Focus: Phase 8 specific changes (Docker + deployment)
- Related: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` (existing, verified for correctness)
- Build: not yet verified (requires `docker build` which was not executed)

## Overall Assessment

The deployment configuration is well-structured overall. The multi-stage build follows best practices, the health check avoids the `curl` dependency trap, and the docker-compose includes the critical `init: true` and `ipc: host` flags for Chromium stability. However, there is **one critical bug** that will prevent Playwright from finding its browsers at runtime, plus a few high-priority issues.

## Critical Issues

### C1. PLAYWRIGHT_BROWSERS_PATH=0 points to wrong directory -- browsers will NOT be found

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/Dockerfile:44,63`

When `PLAYWRIGHT_BROWSERS_PATH=0` is set, Playwright resolves the browser directory as:

```
path.join(__dirname, "..", "..", "..", ".local-browsers")
```

where `__dirname` is `<install>/node_modules/playwright-core/lib/server/registry/`. This resolves to `<install>/.local-browsers` -- NOT `~/.cache/ms-playwright`.

The Dockerfile sets `PLAYWRIGHT_BROWSERS_PATH=0` (line 44) but copies browsers to `/home/pwuser/.cache/ms-playwright` (line 63). At runtime, Playwright will look in `/app/.local-browsers` (standalone root + `.local-browsers`) and find nothing. **Every Playwright fetch will fail silently** (the hybrid fetcher returns `null` on error).

**Fix -- choose one approach:**

Option A (recommended -- remove the env var, use default cache path):
```dockerfile
# Remove this line from the runner stage:
# ENV PLAYWRIGHT_BROWSERS_PATH=0

# Keep the COPY as-is (copies to /home/pwuser/.cache/ms-playwright)
# Default behavior on Linux: XDG_CACHE_HOME || ~/.cache/ms-playwright
# Since pwuser has HOME=/home/pwuser, default resolves to /home/pwuser/.cache/ms-playwright
```

Option B (set the path explicitly to where browsers are copied):
```dockerfile
ENV PLAYWRIGHT_BROWSERS_PATH=/home/pwuser/.cache/ms-playwright
```

Option C (copy to the `.local-browsers` path that `=0` resolves to):
```dockerfile
# Copy to the path Playwright actually checks with =0
COPY --from=playwright-setup --chown=pwuser:pwuser /root/.cache/ms-playwright /app/.local-browsers
```

**Why this is dangerous in production:** The hybrid fetcher (`crawler/hybrid-fetcher.ts`) silently falls back from Cheerio to Playwright. When Playwright fails to launch Chromium (because browser binaries are not found), it returns `null`. The crawler will treat JS-heavy pages as completely unavailable rather than retrying. No error surfaces to the user -- pages silently vanish from results.

## High Priority

### H1. Dockerfile installs full Playwright Chromium in builder but only needs headless shell at runtime

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/Dockerfile:17`

The `playwright-setup` stage runs `npx playwright install --with-deps chromium` which downloads the full Chromium browser (~400-500MB). The app only uses headless mode (`headless: true` in `crawler/playwright.ts:13`). Using `--only-shell` would reduce the browser binary by ~50-100MB.

Consider:
```dockerfile
RUN npx playwright install --with-deps --only-shell chromium
```

Verify the app's Playwright usage works with headless shell before committing. The current code uses basic `page.goto` + `page.content` which should work fine with headless shell.

**Impact:** ~50-100MB reduction in final image size.

### H2. docker-compose.yml missing `version` key --Compose V2 warning

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/docker-compose.yml:1`

The `version` key was removed. While Compose V2 ignores it and only emits a warning, the plan spec includes it (`version: '3.8'`). For consistency with the plan and to avoid warnings in CI logs, either add it back or document the intentional omission.

**Impact:** Low -- cosmetic only, no functional breakage.

### H3. CI build job will fail -- Playwright browsers not installed during `npm run build`

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/.github/workflows/ci.yml:47-56`

The CI `build` job runs `npm ci && npm run build`. The `next build` step traces all imported modules including `playwright-core`. If Next.js attempts any server-side import validation during build, it may invoke Playwright's registry code which attempts to locate browser binaries. Additionally, the standalone output traces the `playwright` package but will not include the browser binaries (they are not in node_modules).

This is not strictly a build failure today (Next.js tracing is static analysis), but the standalone output's `node_modules` will contain `playwright-core` without browsers -- which is exactly why the runner stage must correctly copy browsers.

**Impact:** CI build may produce a standalone bundle that references playwright but has no browsers. This is fine as long as the Dockerfile correctly supplies them (which depends on fixing C1).

### H4. Health check does not verify Playwright/Chromium availability

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/app/api/health/route.ts`

The health endpoint checks Node.js memory but does not verify that Chromium is functional. If Chromium crashes or its binaries are missing (see C1), the health check still returns 200 OK. Docker will never restart the container for the most likely failure mode.

Consider adding a lightweight Chromium check:
```ts
export async function GET() {
  const memUsage = process.memoryUsage();
  const memMb = Math.round(memUsage.heapUsed / 1024 / 1024);

  // Quick Chromium availability check
  let chromiumOk = false;
  try {
    const { chromium } = await import("playwright");
    const executablePath = chromium.executablePath();
    chromiumOk = !!executablePath;
  } catch {
    chromiumOk = false;
  }

  const status = chromiumOk ? "ok" : "degraded";
  return Response.json({
    status,
    timestamp: new Date().toISOString(),
    memory: `${memMb}MB`,
    chromium: chromiumOk,
  }, { status: chromiumOk ? 200 : 503 });
}
```

Note: `chromium.executablePath()` is synchronous and only checks path resolution, it does not launch the browser. Lightweight enough for a health check.

## Medium Priority

### M1. `.dockerignore` excludes `*.md` but the app may need README for Next.js metadata

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/.dockerignore:11`

The `*.md` exclusion is broad. The builder stage copies `. .` (all non-ignored files), so any `.md` files that Next.js build depends on would be missing. Currently this is fine (Next.js does not read `.md` files during build), but it also excludes `CLAUDE.md` and `AGENTS.md` which are intentionally harmless to exclude. No action needed now, just be aware.

### M2. docker-compose.yml does not set `PLAYWRIGHT_BROWSERS_PATH` or pass env vars

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/docker-compose.yml:9-10`

Only `NODE_ENV=production` is set in the environment. If env vars are added later (e.g., `MAX_CRAWL_DEPTH`, external API keys), they must be added here. Currently no env vars are used by the app, so this is fine.

### M3. Deploy workflow is a stub -- no actual deployment step

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/.github/workflows/deploy.yml:21-24`

The deploy workflow only echoes a message and has a commented-out curl to Dokploy webhook. This is expected for Phase 8 (Dokploy deployment is documented but not automated yet). The Docker build+push workflow (`docker.yml`) is complete and correct.

### M4. Docker workflow uses `build-push-action@v5` -- consider v6

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/.github/workflows/docker.yml:44`

The `docker/build-push-action` is at v5. Version 6 is available with improvements. Not a bug -- v5 works fine -- but worth noting for a future update.

## Low Priority

### L1. Dockerfile does not pin Node.js patch version

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/Dockerfile:4`

Uses `node:20-bookworm-slim` which floats to the latest 20.x patch. This is acceptable for a Next.js app but means builds are not fully reproducible. If reproducibility matters, pin to `node:20.x.y-bookworm-slim`.

### L2. Health check `start_period: 40s` may be tight for first build on slow VPS

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/docker-compose.yml:26`

The standalone server starts quickly (~5s), but on a memory-constrained VPS with cold cache, Chromium lazy-loading during the first crawl request could delay readiness. 40s is reasonable but consider 60s for Dokploy deployments on budget VPS.

### L3. `.dockerignore` excludes `.vscode/` but not `.idea/` or other IDE dirs

**File:** `/Users/sandra/Downloads/codeia/ScreamingWeb/.dockerignore:13`

Minor completeness issue. Add `.idea/`, `.fleet/`, etc. if team uses other IDEs.

## Edge Cases Found

1. **Browser-not-found silent failure:** The hybrid fetcher (`hybrid-fetcher.ts:62`) calls `fetchWithPlaywright` which catches all exceptions and returns `null`. If Chromium is missing, no error propagates to the user. Combined with C1, this means JS-heavy sites silently disappear from crawl results.

2. **SIGTERM handler race:** `crawler/playwright.ts:77-78` registers `SIGTERM`/`SIGINT` handlers for browser cleanup. Docker's `init: true` (tini) sends SIGTERM. The handler calls `closeBrowser()` which is async, but Node.js `process.on('SIGTERM')` handlers do not await promises. The browser might not close cleanly before the process exits. This is a pre-existing issue (not introduced in Phase 8) but is relevant to the Docker context.

3. **Standalone output + Playwright tracing:** Next.js standalone mode traces all `require`/`import` paths. It will include `playwright-core` in the standalone bundle but NOT the browser binaries (they are not in `node_modules`). The Dockerfile correctly handles this by copying browsers separately, but only if the path is correct (C1).

4. **Memory health check threshold:** The health endpoint reports memory but never acts on it. If the researcher's recommendation of returning 503 when memory exceeds a threshold is desired, add a check like `if (memMb > 1500) return 503`. This would let Docker auto-restart the container on memory pressure.

5. **Docker Compose `ipc: host` security:** `ipc: host` removes IPC namespace isolation. This is necessary for Chromium but means the container shares the host's shared memory. On a shared VPS, this is a minor security consideration. Acceptable for a single-app VPS deployment.

## Positive Observations

1. **Multi-stage build is well-structured.** The four stages (deps, playwright-setup, builder, runner) correctly separate concerns and minimize the final image size.

2. **Non-root user is correctly set up.** `pwuser` with explicit GID/UID, `--chown` on all COPY commands, `USER pwuser` before EXPOSE. Clean.

3. **Health check uses `node` instead of `curl`.** Smart choice for `bookworm-slim` which does not include curl. The inline fetch-based check is elegant.

4. **`init: true` and `ipc: host`** are both present. These are the two most commonly forgotten flags for Chromium-in-Docker.

5. **`PLAYWRIGHT_BROWSERS_PATH=0` was researched** -- the intent (hermetic install) is correct. Only the destination path is mismatched.

6. **Docker CI workflow is well-configured** with GHCR login, BuildKit caching (`cache-from: type=gha`), metadata extraction, and explicit `linux/amd64` platform targeting.

7. **All files are under 200 lines.** Dockerfile at 69 lines, docker-compose at 26 lines. Well within the project file size guidelines.

## Recommended Actions

1. **[CRITICAL]** Fix `PLAYWRIGHT_BROWSERS_PATH` mismatch (C1). Remove `ENV PLAYWRIGHT_BROWSERS_PATH=0` and let Playwright use the default cache path (`/home/pwuser/.cache/ms-playwright`) where browsers are already being copied.

2. **[HIGH]** Consider `--only-shell` for Playwright install (H1) to reduce image size by ~50-100MB.

3. **[HIGH]** Add Chromium availability check to health endpoint (H4) so Docker can detect and restart on browser failures.

4. **[MEDIUM]** Add a comment to `docker-compose.yml` noting that `ipc: host` is required and should not be removed.

## Metrics

- Type Coverage: N/A (Docker/infra files)
- Test Coverage: No tests for Docker/infra
- Linting Issues: 0 (infra files, no TS linting applicable)
- File Size Compliance: All files under 200 lines (max: Dockerfile at 69)

## Unresolved Questions

1. Should the Docker workflow also build on the `feature/*` branches for PR validation, or only `develop`/`main`?
2. Is a seccomp profile planned for production Dokploy deployment? The researcher report recommends one but it is not included in this phase.
3. Should the health endpoint eventually trigger container restart via 503 status when memory exceeds a threshold (researcher recommendation)?
4. The deploy workflow (`deploy.yml`) is a stub -- is Dokploy webhook automation planned for a later phase?
