import { readFile } from "node:fs/promises";

const publicPackages = [
  "packages/sdk/package.json",
  "packages/cli/package.json",
];

const packages = await Promise.all(
  publicPackages.map(async (path) => {
    const contents = await readFile(path, "utf8");
    const pkg = JSON.parse(contents);
    return {
      name: pkg.name,
      path,
      version: pkg.version,
    };
  }),
);

const versions = new Set(packages.map((pkg) => pkg.version));

if (versions.size > 1) {
  console.error("CodexDock public package versions must match before release.");
  for (const pkg of packages) {
    console.error(`- ${pkg.name}@${pkg.version} (${pkg.path})`);
  }
  process.exit(1);
}

const version = packages[0]?.version ?? "unknown";
console.log(`public package versions ok: ${version}`);
