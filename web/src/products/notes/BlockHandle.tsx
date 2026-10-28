import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useBlockNoteEditor,
  useExtension,
  useExtensionState
} from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  GripVertical,
  Trash2,
  Copy,
  Plus,
  ArrowUp,
  ArrowDown,
  Type,
  Heading,
  ListChecks,
  Code
} from "lucide-react";
import { noteSchema } from "./schema";
export default function BlockHandle() {
  const editor = useBlockNoteEditor(noteSchema),
    side = useExtension(SideMenuExtension),
    block = useExtensionState(SideMenuExtension, {
      selector: (state) => state?.block
    });
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 12, top: 12 });
  const button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    active = useRef(""),
    dragging = useRef(false);
  function close(focus = false) {
    setOpen(false);
    side.unfreezeMenu();
    if (focus) button.current?.focus();
  }
  useEffect(
    () => () => {
      if (side.menuFrozen) side.unfreezeMenu();
    },
    [side]
  );
  useEffect(() => {
    if (!open) return;
    const rect = button.current?.getBoundingClientRect(),
      height = menu.current?.getBoundingClientRect().height || 400;
    if (rect)
      setPosition({
        left: Math.max(12, Math.min(rect.right + 8, innerWidth - 260)),
        top: Math.max(12, Math.min(rect.top, innerHeight - height - 12))
      });
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function outside(event: PointerEvent) {
      if (
        !button.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        close();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!block) return null;
  function action(
    callback: (current: NonNullable<ReturnType<typeof editor.getBlock>>) => void
  ) {
    const current = editor.getBlock(active.current);
    if (current) {
      editor.setTextCursorPosition(current);
      callback(current);
    }
    close();
    editor.focus();
  }
  function duplicate() {
    action((current) => {
      const copy = JSON.parse(JSON.stringify(current));
      function strip(value: { id?: string; children?: unknown[] }) {
        delete value.id;
        value.children?.forEach((child) => strip(child as typeof value));
      }
      strip(copy);
      editor.insertBlocks([copy], current, "after");
    });
  }
  const current = editor.getBlock(open ? active.current : block.id),
    canConvert = current?.content !== undefined;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button note-block-drag"
        aria-label="Block actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Drag to move · click for block actions"
        draggable
        onDragStart={(event) => {
          dragging.current = true;
          setOpen(false);
          side.blockDragStart(event, block);
        }}
        onDragEnd={() => {
          side.blockDragEnd();
          setTimeout(() => {
            dragging.current = false;
          }, 0);
        }}
        onClick={() => {
          if (dragging.current) return;
          if (open) {
            close();
            return;
          }
          active.current = block.id;
          side.freezeMenu();
          setOpen(true);
        }}
      >
        <GripVertical size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="block-handle-menu"
            role="menu"
            aria-label="Block settings"
            style={position}
            onKeyDown={(event) => {
              const items = [
                ...menu.current!.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]'
                )
              ];
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement
              );
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                items[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length
                ]?.focus();
              }
              if (event.key === "Tab") close(true);
            }}
          >
            <button
              role="menuitem"
              type="button"
              onClick={() =>
                action((current) =>
                  editor.insertBlocks([{ type: "paragraph" }], current, "after")
                )
              }
            >
              <Plus size={15} />
              Insert below
            </button>
            <button role="menuitem" type="button" onClick={duplicate}>
              <Copy size={15} />
              Duplicate block
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => action(() => editor.moveBlocksUp())}
            >
              <ArrowUp size={15} />
              Move up
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => action(() => editor.moveBlocksDown())}
            >
              <ArrowDown size={15} />
              Move down
            </button>
            {canConvert && (
              <>
                <span className="eyebrow">TURN INTO</span>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() =>
                    action((current) =>
                      editor.updateBlock(current, { type: "paragraph" })
                    )
                  }
                >
                  <Type size={15} />
                  Text
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() =>
                    action((current) =>
                      editor.updateBlock(current, {
                        type: "heading",
                        props: { level: 2 }
                      })
                    )
                  }
                >
                  <Heading size={15} />
                  Heading
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() =>
                    action((current) =>
                      editor.updateBlock(current, { type: "checkListItem" })
                    )
                  }
                >
                  <ListChecks size={15} />
                  Checklist
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() =>
                    action((current) =>
                      editor.updateBlock(current, {
                        type: "codeBlock",
                        props: { language: "auto" }
                      })
                    )
                  }
                >
                  <Code size={15} />
                  Code
                </button>
              </>
            )}
            <button
              role="menuitem"
              type="button"
              className="block-delete"
              onClick={() =>
                action((current) => editor.removeBlocks([current]))
              }
            >
              <Trash2 size={15} />
              Delete block
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
