import { resolve } from 'node:path';
import { API } from 'typescript/unstable/sync';
import { isStringLiteralLikeNode, isTemplateHead, isTemplateMiddle, isTemplateTail } from 'typescript/unstable/ast';

/** TypeScript 7 parses the real source; comments and template expressions remain distinct. */
export function sourceLiterals(paths) {
  const files = paths.map(path => resolve(path)), api = new API();
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openFiles: files });
    const literals = [];
    const scan = node => {
      if (isStringLiteralLikeNode(node) || isTemplateHead(node) || isTemplateMiddle(node) || isTemplateTail(node)) {
        literals.push(node.text);
      }
      node.forEachChild(scan);
    };
    for (const file of files) {
      const source = snapshot.getDefaultProjectForFile(file)?.program.getSourceFile(file);
      if (!source) throw new Error(`TypeScript source unavailable: ${file}`);
      scan(source);
    }
    return literals;
  } finally { snapshot?.dispose(); api.close(); }
}
