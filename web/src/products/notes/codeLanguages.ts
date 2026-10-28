import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
const grammars = {
  python,
  javascript,
  typescript,
  json,
  bash,
  xml,
  css,
  sql,
  yaml,
  markdown,
  go,
  rust,
  java,
  cpp
};
for (const [name, grammar] of Object.entries(grammars))
  hljs.registerLanguage(name, grammar);
export const codeLanguages: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  bash: "Shell",
  xml: "HTML / XML",
  css: "CSS",
  sql: "SQL",
  yaml: "YAML",
  markdown: "Markdown",
  go: "Go",
  rust: "Rust",
  java: "Java",
  cpp: "C / C++",
  plaintext: "Plain text"
};
export function codeText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : (part?.text ?? codeText(part?.content))
      )
      .join("");
  return "";
}
export function normalizedLanguage(language: string) {
  return (
    (
      {
        py: "python",
        js: "javascript",
        ts: "typescript",
        html: "xml",
        sh: "bash",
        shell: "bash",
        text: "auto",
        plain: "auto"
      } as Record<string, string>
    )[language] ||
    language ||
    "auto"
  );
}
export function highlightedCode(source: string, language: string) {
  const requested = normalizedLanguage(language),
    sample = source.slice(0, 20000);
  let detected = requested;
  if (requested === "auto") {
    if (
      /^\s*(?:def |from \w+ import |import (?:math|sys|os|json|re)\b|print\(|if __name__|for .+ in )/m.test(
        sample
      )
    )
      detected = "python";
    else if (
      /(?:\b(?:const|let|var|function)\s+|console\.|=>|^\s*import .+ from )/m.test(
        sample
      )
    )
      detected = "javascript";
    else
      detected =
        hljs.highlightAuto(sample, Object.keys(grammars)).language ||
        "plaintext";
  }
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return {
    language: detected,
    html:
      source.length > 50000 || !hljs.getLanguage(detected)
        ? escape(source)
        : hljs.highlight(source, { language: detected, ignoreIllegals: true })
            .value
  };
}
export function runnableCells(
  blocks: readonly unknown[]
): { id: string; language: "python" | "javascript"; source: string }[] {
  const results: {
    id: string;
    language: "python" | "javascript";
    source: string;
  }[] = [];
  for (const item of blocks) {
    const block = item as {
      id: string;
      type: string;
      props?: { language?: string };
      content?: unknown;
      children?: unknown[];
    };
    if (block.type === "codeBlock") {
      const source = codeText(block.content),
        language = highlightedCode(
          source,
          block.props?.language || "auto"
        ).language;
      if (language === "python" || language === "javascript")
        results.push({ id: block.id, language, source });
    }
    if (block.children) results.push(...runnableCells(block.children));
  }
  return results;
}
