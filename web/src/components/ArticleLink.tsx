import { useState, type ReactNode } from "react";
import { nativeRequest } from "../lib/native";

export default function ArticleLink({
  url,
  title,
  children,
  className
}: {
  url: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={className}
        onClick={(event) => {
          if (
            !window.ReactNativeWebView ||
            !window.omnixNativeCapabilities?.includes("article-reader") ||
            !url.startsWith("https://")
          )
            return;
          event.preventDefault();
          setError("");
          void nativeRequest(
            "omnix-open-article",
            { url, title: title.slice(0, 250) },
            10000
          ).catch((e) => setError((e as Error).message));
        }}
      >
        {children}
      </a>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
