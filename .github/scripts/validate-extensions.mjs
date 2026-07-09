import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const ignoredRootDirs = new Set(["node_modules", "dist", "build", "coverage"]);

const errors = [];

const exists = async (filePath) => {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(repoRoot, filePath)} is not valid JSON: ${error.message}`);
    return null;
  }
};

const requireString = (manifest, fieldName, manifestPath) => {
  if (typeof manifest[fieldName] !== "string" || manifest[fieldName].trim() === "") {
    errors.push(`${path.relative(repoRoot, manifestPath)} must include a non-empty ${fieldName}`);
  }
};

const requireReferencedFile = async (extensionDir, relativeFile, source) => {
  if (typeof relativeFile !== "string" || relativeFile.trim() === "") {
    errors.push(`${source} must reference a non-empty file path`);
    return;
  }

  const target = path.resolve(extensionDir, relativeFile);
  const insideExtension = target === extensionDir || target.startsWith(`${extensionDir}${path.sep}`);

  if (!insideExtension) {
    errors.push(`${source} must stay inside its extension folder`);
    return;
  }

  if (!(await exists(target))) {
    errors.push(`${source} references missing file ${relativeFile}`);
  }
};

const validateExtension = async (entryName) => {
  const extensionDir = path.join(repoRoot, entryName);
  const manifestPath = path.join(extensionDir, "manifest.json");

  if (!(await exists(manifestPath))) {
    errors.push(`${entryName} is missing manifest.json`);
    return;
  }

  const manifest = await readJson(manifestPath);
  if (!manifest) {
    return;
  }

  if (manifest.manifest_version !== 3) {
    errors.push(`${entryName}/manifest.json must use manifest_version 3`);
  }

  requireString(manifest, "name", manifestPath);
  requireString(manifest, "version", manifestPath);

  if (manifest.action?.default_popup) {
    await requireReferencedFile(extensionDir, manifest.action.default_popup, `${entryName} action.default_popup`);
  }

  if (manifest.background?.service_worker) {
    await requireReferencedFile(extensionDir, manifest.background.service_worker, `${entryName} background.service_worker`);
  }

  for (const [index, script] of Object.entries(manifest.content_scripts ?? [])) {
    for (const jsFile of script.js ?? []) {
      await requireReferencedFile(extensionDir, jsFile, `${entryName} content_scripts[${index}].js`);
    }

    for (const cssFile of script.css ?? []) {
      await requireReferencedFile(extensionDir, cssFile, `${entryName} content_scripts[${index}].css`);
    }
  }

  for (const [size, iconFile] of Object.entries(manifest.icons ?? {})) {
    await requireReferencedFile(extensionDir, iconFile, `${entryName} icons.${size}`);
  }
};

const entries = await readdir(repoRoot, { withFileTypes: true });
const extensionDirs = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => !name.startsWith(".") && !ignoredRootDirs.has(name))
  .sort();

if (extensionDirs.length === 0) {
  errors.push("No extension folders found at the repository root");
}

for (const extensionDir of extensionDirs) {
  await validateExtension(extensionDir);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${extensionDirs.length} extension folder(s): ${extensionDirs.join(", ")}`);
