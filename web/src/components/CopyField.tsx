import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export default function CopyField({
  label = "Callback URL",
  value,
  name
}: {
  label?: string;
  value: string;
  name: string;
}) {
  const id = useId(),
    feedbackId = id + "-feedback",
    input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">(
    "idle"
  );
  useEffect(() => setState("idle"), [value]);
  async function copy() {
    if (!value || state === "copying") return;
    setState("copying");
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      input.current?.focus();
      input.current?.select();
      setState("failed");
    }
  }
  return (
    <div className="copy-field">
      <label htmlFor={id}>{label}</label>
      <div className="copy-field-control">
        <input
          ref={input}
          id={id}
          aria-label={name}
          aria-describedby={feedbackId}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          spellCheck={false}
        />
        <button
          type="button"
          className="icon-button"
          title={"Copy " + name}
          aria-label={"Copy " + name}
          disabled={!value || state === "copying"}
          onClick={copy}
        >
          {state === "copied" ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <span
        id={feedbackId}
        className={"copy-field-feedback " + (state === "failed" ? "error" : "")}
        role="status"
      >
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy unavailable. Select the URL and copy it manually."
            : ""}
      </span>
    </div>
  );
}
