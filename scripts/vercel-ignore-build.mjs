#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const watchedPaths = [
  "docs",
  "apps/example-web",
  "packages/sdk/src",
  "packages/sdk/package.json",
  "packages/sdk/tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vercel.json",
];

const currentSha = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD";
const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";

const diff = spawnSync(
  "git",
  ["diff", "--quiet", previousSha, currentSha, "--", ...watchedPaths],
  { encoding: "utf8" },
);

if (diff.status === 0) {
  console.log("No documentation site changes detected. Skipping Vercel build.");
  process.exit(0);
}

if (diff.status === 1) {
  console.log("Documentation site changes detected. Continuing Vercel build.");
  process.exit(1);
}

console.log("Could not compare changed paths. Continuing Vercel build.");
if (diff.stderr) console.log(diff.stderr.trim());
process.exit(1);
