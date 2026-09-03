import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
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
    const classicSources = [];
    for (const jsFile of script.js ?? []) {
      await requireReferencedFile(extensionDir, jsFile, `${entryName} content_scripts[${index}].js`);
      if (script.type === "module") {
        continue;
      }
      const source = await readFile(path.resolve(extensionDir, jsFile), "utf8");
      classicSources.push(source);
      if (/^\s*(import|export)\s/m.test(source)) {
        errors.push(
          `${entryName} content_scripts[${index}].js ${jsFile} uses import/export but is not type:module`,
        );
      }
    }

    // Chrome runs every classic file of one entry against the same global lexical
    // scope. A name declared in two of them is a SyntaxError that silently drops the
    // second file, so compile the concatenation the way the browser would see it.
    if (classicSources.length > 1) {
      try {
        new vm.Script(classicSources.join("\n"), { filename: `${entryName} content_scripts[${index}]` });
      } catch (error) {
        errors.push(
          `${entryName} content_scripts[${index}].js files clash in the shared global scope: ${error.message}`,
        );
      }
    }

    for (const cssFile of script.css ?? []) {
      await requireReferencedFile(extensionDir, cssFile, `${entryName} content_scripts[${index}].css`);
    }
  }

  const requiredIconSizes = ["16", "48", "128"];
  for (const size of requiredIconSizes) {
    if (!manifest.icons?.[size]) {
      errors.push(`${entryName}/manifest.json must include icons.${size}`);
    }
  }

  for (const [size, iconFile] of Object.entries(manifest.icons ?? {})) {
    await requireReferencedFile(extensionDir, iconFile, `${entryName} icons.${size}`);
  }

  for (const [size, iconFile] of Object.entries(manifest.action?.default_icon ?? {})) {
    await requireReferencedFile(extensionDir, iconFile, `${entryName} action.default_icon.${size}`);
  }
};

const extensionDirs = ["utils"];

for (const extensionDir of extensionDirs) {
  await validateExtension(extensionDir);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${extensionDirs.length} extension folder(s): ${extensionDirs.join(", ")}`);
