import ts from 'typescript';

function staticName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/** AST 扫描避免把注释、字符串当成授权使用；GM.* 与 GM_* 保留各自授权名。 */
export function gmUsages(code) {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.ES2022, true);
  const names = new Set();
  const addLegacy = (name) => {
    if (/^GM_[A-Za-z]+$/.test(name) && name !== 'GM_info') names.add(name);
  };
  const visit = (node) => {
    if (ts.isIdentifier(node)) addLegacy(node.text);
    const name = staticName(node);
    if (name !== undefined) {
      addLegacy(name);
      const receiver = node.expression;
      if (
        ((ts.isIdentifier(receiver) && receiver.text === 'GM') || staticName(receiver) === 'GM') &&
        /^[A-Za-z]+$/.test(name) &&
        name !== 'info'
      ) {
        names.add(`GM.${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}
