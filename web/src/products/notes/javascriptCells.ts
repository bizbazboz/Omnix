import { parse } from "acorn";
// Cells keep top-level bindings between runs while supporting top-level await.
export function prepareJavaScript(source: string) {
  const tree = parse(source, {
    ecmaVersion: "latest",
    allowAwaitOutsideFunction: true
  }) as unknown as { body: Node[] };
  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [],
    names = new Set<string>();
  function bindings(node: Node | null | undefined): void {
    if (!node) return;
    if (node.type === "Identifier") names.add(node.name!);
    else if (node.type === "ObjectPattern")
      node.properties?.forEach((item) =>
        bindings(item.type === "RestElement" ? item.argument : item.value)
      );
    else if (node.type === "ArrayPattern") node.elements?.forEach(bindings);
    else if (node.type === "AssignmentPattern") bindings(node.left);
    else if (node.type === "RestElement") bindings(node.argument);
  }
  for (const node of tree.body) {
    if (node.type === "VariableDeclaration") {
      node.declarations?.forEach((item) => bindings(item.id));
      edits.push({
        start: node.start,
        end: node.start + node.kind!.length,
        text: "var"
      });
    }
    if (node.type === "FunctionDeclaration") bindings(node.id);
    if (node.type === "ClassDeclaration" && node.id) {
      bindings(node.id);
      edits.push({
        start: node.start,
        end: node.start,
        text: "var " + node.id.name + " = "
      });
    }
  }
  const last = tree.body.at(-1);
  if (last?.type === "ExpressionStatement" && last.expression)
    edits.push({
      start: last.start,
      end: last.end,
      text:
        "return (" +
        source.slice(last.expression.start, last.expression.end) +
        ");"
    });
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return (
    "try {\n" +
    source +
    "\n} finally {\n" +
    [...names]
      .map(
        (name) =>
          "if(typeof " +
          name +
          " !== 'undefined')globalThis[" +
          JSON.stringify(name) +
          "]=" +
          name +
          ";"
      )
      .join("\n") +
    "\n}"
  );
}
type Node = {
  type: string;
  start: number;
  end: number;
  name?: string;
  kind?: string;
  id?: Node;
  expression?: Node;
  declarations?: Node[];
  properties?: Node[];
  elements?: (Node | null)[];
  argument?: Node;
  value?: Node;
  left?: Node;
};
