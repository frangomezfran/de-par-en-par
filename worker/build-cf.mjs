import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const clientDir = path.join(rootDir, 'client');
const distDir = path.join(clientDir, 'dist');
const mediaSrc = path.join(rootDir, 'data', 'media');
const mediaDest = path.join(distDir, 'media');
const manifestOut = path.join(rootDir, 'worker', 'generated-static-media.json');

console.log('[build-cf] Building Vite client...');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execSync(`${npmCmd} run build`, { cwd: clientDir, stdio: 'inherit' });

const staticMediaPaths = [];

function copyMediaRecursive(srcDir, destDir, urlPrefix) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '_temp' || entry.name === 'manifest.json') continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const urlPath = `${urlPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      copyMediaRecursive(srcPath, destPath, urlPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      staticMediaPaths.push(urlPath);
    }
  }
}

console.log('[build-cf] Copying static media into client/dist/media...');
copyMediaRecursive(mediaSrc, mediaDest, '/media');
staticMediaPaths.sort();

fs.writeFileSync(manifestOut, JSON.stringify(staticMediaPaths, null, 2) + '\n', 'utf-8');
console.log(`[build-cf] Bundled ${staticMediaPaths.length} static media files.`);
