import { join } from 'path';
import { readFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseModule } from 'meriyah';
import { rebuildAllTokens, print } from 'ast-tokens';

const __dirname = dirname(fileURLToPath(import.meta.url));

const readFixture = (path) => readFile(join(__dirname, 'fixtures', path), 'utf-8');

const sourceText = await readFixture('imports.js');
const ast = parseModule(sourceText, { ranges: true });

rebuildAllTokens(ast, { overwrite: true, sourceText });

if (print(ast) !== sourceText) {
  throw new Error('How has it all gone wrong?');
}

console.log(JSON.stringify(ast, undefined, 2));