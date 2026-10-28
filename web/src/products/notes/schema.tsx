import {
  BlockNoteSchema,
  defaultBlockSpecs,
  createCodeBlockSpec
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import LiveReference, {
  referenceLabels,
  referencePath
} from "./WorkspaceReference";
import CodeCell from "./CodeCell";
import { codeText } from "./codeLanguages";
const baseCode = createCodeBlockSpec({ defaultLanguage: "auto" });
const notebookCode = createReactBlockSpec(
  {
    type: "codeBlock",
    propSchema: { language: { default: "auto" } },
    content: "plain"
  },
  {
    meta: { code: true, defining: true, isolating: false },
    parse: baseCode.implementation.parse,
    parseContent: baseCode.implementation.parseContent,
    render: ({ block, editor, contentRef }) => (
      <CodeCell
        id={block.id}
        source={codeText(block.content)}
        language={block.props.language}
        contentRef={contentRef}
        onLanguage={(language) =>
          editor.updateBlock(block, { props: { language } })
        }
      />
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <pre>
        <code
          data-language={block.props.language}
          className={"language-" + block.props.language}
          ref={contentRef}
        />
      </pre>
    )
  },
  baseCode.extensions
);
const workspaceEmbed = createReactBlockSpec(
  {
    type: "workspaceEmbed",
    propSchema: {
      kind: {
        default: "mail",
        values: ["mail", "event", "issue", "project", "page"] as const
      },
      itemId: { default: "" },
      containerId: { default: "" }
    },
    content: "none"
  },
  {
    render: ({ block }) => <LiveReference {...block.props} />,
    toExternalHTML: ({ block }) => (
      <a
        href={referencePath(
          block.props.kind,
          block.props.itemId,
          block.props.containerId
        )}
      >
        {referenceLabels[block.props.kind]}
      </a>
    )
  }
);
const divider = createReactBlockSpec(
  { type: "divider", propSchema: {}, content: "none" },
  {
    render: () => <hr className="note-divider" />,
    toExternalHTML: () => <hr />
  }
);
const callout = createReactBlockSpec(
  { type: "callout", propSchema: {}, content: "inline" },
  {
    render: ({ contentRef }) => (
      <aside className="note-callout">
        <span aria-hidden="true">!</span>
        <div ref={contentRef} />
      </aside>
    ),
    toExternalHTML: ({ contentRef }) => <blockquote ref={contentRef} />
  }
);
const { audio, video, ...blocks } = defaultBlockSpecs;
void audio;
void video;
export const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...blocks,
    codeBlock: notebookCode(),
    divider: divider(),
    callout: callout(),
    workspaceEmbed: workspaceEmbed()
  }
});
export type NoteBlock = typeof noteSchema.Block;
export type NotesEditor = typeof noteSchema.BlockNoteEditor;
