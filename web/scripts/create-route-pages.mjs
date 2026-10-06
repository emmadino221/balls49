import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const indexFile = path.join(outputDirectory, 'index.html');
const pageFiles = [
  'about.html',
  'pricing.html',
  'predictions.html',
  'history.html',
  'guide.html',
  'calculator.html',
  'testimonials.html',
  'contact.html',
  'free-trial.html',
  'login.html',
  'signup.html'
];

await Promise.all(pageFiles.map(page => copyFile(indexFile, path.join(outputDirectory, page))));
console.log(`[Build] Created ${pageFiles.length} static page entry points.`);
