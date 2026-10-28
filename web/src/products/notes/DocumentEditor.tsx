import { SuggestionMenu } from "@blocknote/core/extensions";
import {
  BlockNoteViewRaw,
  SideMenuController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  type SuggestionMenuProps,
  type DefaultReactSuggestionItem
} from "@blocknote/react";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import "@blocknote/react/style.css";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link2,
  List,
  Undo2,
  Redo2,
  Paperclip,
  ArrowUp,
  ArrowDown,
  IndentIncrease,
  IndentDecrease
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { canonicalWorkspaceUrl, isWorkspaceHref } from "../../lib/routes";
import { useNavigate } from "react-router-dom";
import Select from "../../components/Select";
import { noteSchema, type NoteBlock, type NotesEditor } from "./schema";
import { notesApi, type PageInfo } from "./api";
import ReferencePicker from "./ReferencePicker";
import type { ReferenceKind } from "./WorkspaceReference";
import { NotebookProvider, NotebookToolbar } from "./NotebookExecution";
import BlockHandle from "./BlockHandle";
import ActionMenu from "./ActionMenu";
function SlashMenu({
  items,
  selectedIndex,
  onItemClick
}: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  return (
    <div className="note-slash-menu" role="listbox" aria-label="Insert block">
      {items.map((item, index) => (
        <button
          type="button"
          role="option"
          aria-selected={selectedIndex === index}
          key={item.title}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onItemClick?.(item)}
        >
          <strong>{item.title}</strong>
          <small>{item.subtext}</small>
        </button>
      ))}
      {!items.length && <span>No matching blocks</span>}
    </div>
  );
}
export default function DocumentEditor({
  id,
  initial,
  onChange,
  onReady,
  readOnly = false,
  disabled = false,
  links = [],
  onCreateSubpage
}: {
  id: string;
  initial: NoteBlock[];
  onChange: (blocks: NoteBlock[]) => void;
  onReady?: (editor: NotesEditor) => void;
  readOnly?: boolean;
  disabled?: boolean;
  links?: PageInfo[];
  onCreateSubpage?: () => Promise<PageInfo>;
}) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const [blockType, setBlockType] = useState("paragraph"),
    [picker, setPicker] = useState<{
      kind: ReferenceKind;
      blockId: string;
    } | null>(null),
    [error, setError] = useState("");
  const editor = useCreateBlockNote(
    {
      schema: noteSchema,
      initialContent: initial,
      uploadFile: async (file) => {
        const result = await notesApi<{ url: string }>(
          `/pages/${id}/assets?name=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream"
            },
            body: file
          }
        );
        return result.url;
      }
    },
    [id]
  );
  useEffect(() => {
    onReady?.(editor);
  }, [editor]);
  function action(callback: () => void) {
    try {
      callback();
      editor.focus();
    } catch {
      setError("That action is unavailable at this selection.");
    }
  }
  function reference(kind: ReferenceKind) {
    setPicker({ kind, blockId: editor.getTextCursorPosition().block.id });
  }
  return (
    <NotebookProvider enabled={!readOnly && !disabled}>
      <div
        className={"note-document " + (readOnly ? "note-preview" : "")}
        onClickCapture={(event) => {
          const anchor = (event.target as HTMLElement).closest?.("a");
          const rawHref = anchor?.getAttribute("href");
          const href = rawHref ? canonicalWorkspaceUrl(rawHref) : "";
          if (
            isWorkspaceHref(href) &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            navigate(href);
          }
        }}
      >
        {!readOnly && (
          <fieldset
            className="note-format-toolbar"
            disabled={disabled}
            aria-label="Document formatting"
          >
            <Select
              aria-label="Block type"
              value={blockType}
              onChange={(event) =>
                action(() => {
                  const block = editor.getTextCursorPosition().block;
                  const type = event.target.value;
                  if (type.startsWith("heading"))
                    editor.updateBlock(block, {
                      type: "heading",
                      props: { level: Number(type.slice(-1)) as 1 | 2 | 3 }
                    });
                  else editor.updateBlock(block, { type: type as "paragraph" });
                  setBlockType(type);
                })
              }
            >
              <option value="paragraph">Text</option>
              <option value="heading1">Heading 1</option>
              <option value="heading2">Heading 2</option>
              <option value="heading3">Heading 3</option>
              <option value="bulletListItem">Bullet list</option>
              <option value="numberedListItem">Numbered list</option>
              <option value="checkListItem">Checklist</option>
              <option value="toggleListItem">Toggle</option>
              <option value="quote">Quote</option>
              <option value="codeBlock">Code</option>
              <option value="callout">Callout</option>
            </Select>
            <button
              type="button"
              className="icon-button"
              aria-label="Bold"
              title="Bold"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => action(() => editor.toggleStyles({ bold: true }))}
            >
              <Bold size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Italic"
              title="Italic"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                action(() => editor.toggleStyles({ italic: true }))
              }
            >
              <Italic size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Insert block"
              title="Insert block"
              onClick={() =>
                editor.getExtension(SuggestionMenu)?.openSuggestionMenu("/")
              }
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Attach image or file"
              title="Attach image or file"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <ActionMenu label="More tools" compact>
              <button
                type="button"
                className="icon-button"
                aria-label="Strikethrough"
                title="Strikethrough"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  action(() => editor.toggleStyles({ strike: true }))
                }
              >
                <Strikethrough size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Inline code"
                title="Inline code"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  action(() => editor.toggleStyles({ code: true }))
                }
              >
                <Code size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Add link"
                title="Add link"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const url = window.prompt("Link URL or /notes/pages/…");
                  if (
                    url &&
                    (/^(https?:|mailto:)/i.test(url) ||
                      isWorkspaceHref(canonicalWorkspaceUrl(url)))
                  )
                    action(() =>
                      editor.createLink(
                        canonicalWorkspaceUrl(url),
                        editor.getSelectedText() || url
                      )
                    );
                  else if (url)
                    setError("Use an HTTP, HTTPS, mail or internal note link.");
                }}
              >
                <Link2 size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Link to page"
                title="Link to page"
                onClick={() =>
                  editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@")
                }
              >
                <Link2 size={16} />
              </button>

              <button
                type="button"
                className="icon-button"
                aria-label="Move block up"
                title="Move block up"
                onClick={() => action(() => editor.moveBlocksUp())}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Move block down"
                title="Move block down"
                onClick={() => action(() => editor.moveBlocksDown())}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Nest block"
                title="Nest block"
                onClick={() => action(() => editor.nestBlock())}
              >
                <IndentIncrease size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Unnest block"
                title="Unnest block"
                onClick={() => action(() => editor.unnestBlock())}
              >
                <IndentDecrease size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Undo"
                title="Undo"
                onClick={() =>
                  action(() => {
                    editor.undo();
                  })
                }
              >
                <Undo2 size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Redo"
                title="Redo"
                onClick={() =>
                  action(() => {
                    editor.redo();
                  })
                }
              >
                <Redo2 size={16} />
              </button>
            </ActionMenu>
          </fieldset>
        )}
        <NotebookToolbar blocks={editor.document} />
        {picker && (
          <ReferencePicker
            initialKind={picker.kind}
            onClose={() => {
              setPicker(null);
              editor.focus();
            }}
            onSelect={(item, embed) => {
              action(() => {
                editor.setTextCursorPosition(picker.blockId, "end");
                if (embed)
                  insertOrUpdateBlockForSlashMenu(editor, {
                    type: "workspaceEmbed",
                    props: {
                      kind: item.kind,
                      itemId: item.id,
                      containerId: item.container_id
                    }
                  });
                else
                  editor.insertInlineContent([
                    { type: "link", href: item.href, content: item.title }
                  ]);
              });
              setPicker(null);
            }}
          />
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void (async () => {
                try {
                  const uploaded = await notesApi<{
                    url: string;
                    content_type: string;
                  }>(
                    `/pages/${id}/assets?name=${encodeURIComponent(file.name)}`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": file.type || "application/octet-stream"
                      },
                      body: file
                    }
                  );
                  editor.insertBlocks(
                    [
                      {
                        type: uploaded.content_type.startsWith("image/")
                          ? "image"
                          : "file",
                        props: { url: uploaded.url, name: file.name }
                      }
                    ],
                    editor.getTextCursorPosition().block,
                    "after"
                  );
                  editor.focus();
                } catch (error) {
                  setError((error as Error).message);
                }
              })();
          }}
        />
        {error && (
          <p className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </p>
        )}
        <BlockNoteViewRaw
          editor={editor}
          editable={!readOnly && !disabled}
          theme="dark"
          formattingToolbar={false}
          slashMenu={false}
          sideMenu={false}
          linkToolbar={false}
          filePanel={false}
          tableHandles={false}
          emojiPicker={false}
          onChange={() => change.current(editor.document)}
          onSelectionChange={() => {
            const block = editor.getTextCursorPosition().block;
            setBlockType(
              block.type === "heading"
                ? "heading" + block.props.level
                : block.type
            );
          }}
        >
          {!readOnly && !disabled && (
            <SideMenuController sideMenu={BlockHandle} />
          )}
          {!readOnly && !disabled && (
            <SuggestionMenuController
              triggerCharacter="@"
              getItems={async (query): Promise<DefaultReactSuggestionItem[]> =>
                links
                  .filter(
                    (page) =>
                      page.id !== id &&
                      page.title.toLowerCase().includes(query.toLowerCase())
                  )
                  .slice(0, 30)
                  .map((page) => ({
                    title: page.title,
                    subtext: "Link to page",
                    onItemClick: () =>
                      editor.insertInlineContent([
                        {
                          type: "link",
                          href: "/notes/pages/" + page.id,
                          content: page.title
                        }
                      ])
                  }))
              }
              suggestionMenuComponent={SlashMenu}
              onItemClick={(item) => item.onItemClick()}
            />
          )}
          {!readOnly && !disabled && (
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query): Promise<DefaultReactSuggestionItem[]> =>
                [
                  ...(
                    [
                      ["mail", "Email", "Embed or link a synced email"],
                      [
                        "event",
                        "Calendar event",
                        "Embed or link a calendar occurrence"
                      ],
                      ["issue", "Issue", "Embed or link a project ticket"],
                      ["project", "Project", "Embed or link a project"],
                      ["page", "Page card", "Embed a linked page or folder"]
                    ] as const
                  ).map(([kind, title, subtext]) => ({
                    title,
                    subtext,
                    onItemClick: () => reference(kind)
                  })),
                  {
                    title: "Today's date",
                    subtext: "Insert the current date",
                    onItemClick: () =>
                      editor.insertInlineContent(
                        new Date().toLocaleDateString(undefined, {
                          dateStyle: "long"
                        })
                      )
                  },
                  ...(onCreateSubpage
                    ? [
                        {
                          title: "Subpage",
                          subtext: "Create a nested page",
                          onItemClick: () => {
                            void onCreateSubpage()
                              .then((page) =>
                                insertOrUpdateBlockForSlashMenu(editor, {
                                  type: "paragraph",
                                  content: [
                                    {
                                      type: "link",
                                      href: "/notes/pages/" + page.id,
                                      content: page.title
                                    }
                                  ]
                                })
                              )
                              .catch((error) => setError(error.message));
                          }
                        }
                      ]
                    : []),
                  {
                    title: "Link to page",
                    subtext: "Reference another page or folder",
                    onItemClick: () =>
                      editor
                        .getExtension(SuggestionMenu)
                        ?.openSuggestionMenu("@")
                  },
                  ...getDefaultReactSlashMenuItems(editor).filter(
                    (item) =>
                      !["Image", "File", "Video", "Audio"].includes(item.title)
                  ),
                  {
                    title: "Attachment",
                    subtext: "Upload an image or file",
                    onItemClick: () => fileInput.current?.click()
                  },
                  {
                    title: "Divider",
                    subtext: "A horizontal separator",
                    onItemClick: () => {
                      insertOrUpdateBlockForSlashMenu(editor, {
                        type: "divider"
                      });
                    }
                  },
                  {
                    title: "Callout",
                    subtext: "A highlighted note",
                    onItemClick: () => {
                      insertOrUpdateBlockForSlashMenu(editor, {
                        type: "callout"
                      });
                    }
                  }
                ].filter((item) =>
                  (item.title + " " + (item.subtext || ""))
                    .toLowerCase()
                    .includes(query.toLowerCase())
                )
              }
              suggestionMenuComponent={SlashMenu}
              onItemClick={(item) => item.onItemClick()}
            />
          )}
        </BlockNoteViewRaw>
      </div>
    </NotebookProvider>
  );
}
