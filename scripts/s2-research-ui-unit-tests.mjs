import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const load = createRequire(import.meta.url)
const root = process.cwd()
const ts = load(path.join(root, 'node_modules/typescript'))

load.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  module._compile(output, filename)
}

load(path.join(root, 'src/lib/research-ui-state.test.ts'))
load(path.join(root, 'src/lib/research-campaign-core.test.ts'))
