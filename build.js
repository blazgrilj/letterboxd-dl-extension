const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const EXT_DIR = "./extension";
const ACTIVE_MANIFEST = path.join(EXT_DIR, "manifest.json");

const chromeManifest = require("./extension/manifest.chrome.json");
const version = chromeManifest.version;

const TARGETS = [
  { manifest: "manifest.chrome.json", output: `letterboxd-dl-${version}.zip` },
  { manifest: "manifest.firefox.json", output: `letterboxd-dl-${version}-firefox.zip` },
  // Safari: unzip on a Mac and run build-safari.sh (needs Xcode).
  { manifest: "manifest.safari.json", output: `letterboxd-dl-${version}-safari.zip` },
];

// Browser-specific manifests are never shipped; the chosen one becomes manifest.json.
const isBrowserManifest = (file) => /^manifest\..+\.json$/.test(file);

function createZip(manifestFile, outputName) {
  const zip = new AdmZip();

  fs.copyFileSync(path.join(EXT_DIR, manifestFile), ACTIVE_MANIFEST);

  for (const file of fs.readdirSync(EXT_DIR)) {
    if (isBrowserManifest(file) || file === ".git") continue;

    const fullPath = path.join(EXT_DIR, file);

    if (fs.statSync(fullPath).isDirectory()) {
      zip.addLocalFolder(fullPath, file);
    } else {
      zip.addLocalFile(fullPath);
    }
  }

  zip.writeZip(outputName);

  console.log(`Created ${outputName}`);
}

// Keep the developer's manifest.json (used for "Load unpacked") intact.
const originalManifest = fs.existsSync(ACTIVE_MANIFEST)
  ? fs.readFileSync(ACTIVE_MANIFEST)
  : null;

try {
  TARGETS.forEach(({ manifest, output }) => createZip(manifest, output));
} finally {
  if (originalManifest) {
    fs.writeFileSync(ACTIVE_MANIFEST, originalManifest);
  } else {
    fs.unlinkSync(ACTIVE_MANIFEST);
  }
}

console.log("Done.");
