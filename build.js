const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const EXT_DIR = "./extension";

const chromeManifest = require("./extension/manifest.chrome.json");
const version = chromeManifest.version;

const chromeZipName = `letterboxd-dl-${version}.zip`;
const firefoxZipName = `letterboxd-dl-${version}-firefox.zip`;

function createZip(manifestFile, outputName) {
  const zip = new AdmZip();

  // write active manifest
  fs.copyFileSync(
    path.join(EXT_DIR, manifestFile),
    path.join(EXT_DIR, "manifest.json")
  );

  const files = fs.readdirSync(EXT_DIR);

  for (const file of files) {
    if (
      file === "manifest.chrome.json" ||
      file === "manifest.firefox.json" ||
      file === ".git"
    ) {
      continue;
    }

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

createZip("manifest.chrome.json", chromeZipName);
createZip("manifest.firefox.json", firefoxZipName);

fs.unlinkSync(path.join(EXT_DIR, "manifest.json"));

console.log("Done.");