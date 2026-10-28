// CI component units, not browser E2E: execute real React effects/state while
// replacing only the PTY/network and canvas peripherals with isolated fixtures.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = new URL('../../', import.meta.url);
const fixtures = new URL('./peripherals.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/api/connect/remote' || specifier.startsWith('@xterm/')) return { url: fixtures, shortCircuit: true };
    if (specifier.startsWith('@/')) specifier = new URL('src/' + specifier.slice(2), root).href;
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
      const url = specifier.startsWith('file:') ? new URL(specifier) : new URL(specifier, context.parentURL);
      const path = fileURLToPath(url);
      for (const suffix of ['', '.ts', '.tsx']) {
        if (existsSync(path + suffix) && /\.(ts|tsx)$/.test(path + suffix)) return { url: pathToFileURL(path + suffix).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(root.href) && /\.(ts|tsx)$/.test(url)) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true } }).outputText };
    }
    return next(url, context);
  },
});
