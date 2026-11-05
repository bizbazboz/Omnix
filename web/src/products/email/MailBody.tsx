import { useEffect, useRef, useState } from "react";
import SegmentedControl from "../../components/SegmentedControl";
export default function MailBody({
  html,
  body
}: {
  html: string;
  body: string;
}) {
  const [images, setImages] = useState(false);
  const [mode, setMode] = useState<"original" | "dark" | "text">("original");
  const [fit, setFit] = useState<"fit" | "actual">("fit");
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const bridge = new URL("/mail-frame-resize.js", window.location.origin).href;
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "omnix-email-height"
      )
        return;
      const value = event.data.height;
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 1 &&
        value <= 1000000
      )
        setHeight(Math.ceil(value));
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, []);
  const remote = /<img\b[^>]*\bsrc=["']https?:/i.test(html);
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:" +
    (images ? " https: http:" : "") +
    "; script-src " +
    bridge +
    "; font-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none';";
  return (
    <div className="mail-document">
      <div className="mail-display-options">
        <SegmentedControl
          label="Email appearance"
          value={mode}
          onChange={setMode}
          options={[
            { value: "original", label: "Original" },
            { value: "dark", label: "Dark" },
            { value: "text", label: "Plain text" }
          ]}
        />
        {html && mode !== "text" && (
          <SegmentedControl
            label="Email sizing"
            value={fit}
            onChange={setFit}
            options={[
              { value: "fit", label: "Fit width" },
              { value: "actual", label: "Actual size" }
            ]}
          />
        )}
        {remote && (
          <button className="remote-images" onClick={() => setImages(!images)}>
            {images ? "Block images" : "Load remote images"}
          </button>
        )}
      </div>
      {html && mode !== "text" ? (
        <iframe
          ref={frame}
          style={{ height }}
          title="Email content"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className={"mail-frame mail-frame-" + mode}
          srcDoc={
            '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' +
            csp +
            '"><style>html{color-scheme:light}body{margin:0;padding:0;font:14px/1.6 Arial,sans-serif;color:#202020;background:#fff;overflow-wrap:anywhere}#omnix-email-root{display:flow-root;box-sizing:border-box;padding:clamp(12px,3vw,24px);transform-origin:top left}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#165cbb}' +
            (mode === "dark"
              ? "html{filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}"
              : "") +
            '</style></head><body><div id="omnix-email-root">' +
            html +
            '</div><script data-fit="' +
            (fit === "fit" ? "true" : "false") +
            '" src="' +
            bridge +
            '"></script></body></html>'
          }
        />
      ) : (
        <div className="mail-text">
          {body || "This message has no text body."}
        </div>
      )}
    </div>
  );
}
