import { QueryClient } from "@tanstack/react-query";
export type User = {
  id: string;
  name: string;
  email: string;
  csrf: string;
  is_admin: boolean;
};
export type Account = {
  id: string;
  label: string;
  address: string;
  provider: string;
  status: string;
  can_send: boolean;
  can_read: boolean;
  last_sync: string;
  error: string;
};
export type Message = {
  id: string;
  mailbox: string;
  account: string;
  address: string;
  sender: string;
  sender_name: string;
  recipients: string;
  subject: string;
  preview: string;
  body?: string;
  html?: string;
  unread: boolean;
  starred: boolean;
  date: string;
  folder: string;
  cc?: string;
  reply_to?: string;
  attachments?: { id: string; name: string; size: number; cid?: string }[];
  attachment_notice?: string;
};
export type Draft = {
  id?: string;
  version: number;
  mailbox: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  from_address?: string;
  attachments?: string[];
  reply_to_message?: string;
};
let csrf = "";
export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers
    }
  });
  if (response.status === 401 && path !== "/me") {
    qc.clear();
    window.location.assign("/");
  }
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Request failed" }));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : Array.isArray(error.detail)
          ? error.detail
              .map((e: any) => e.loc.slice(1).join(".") + ": " + e.msg)
              .join("; ")
          : "Request failed"
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } }
});

export function setCsrf(value: string) {
  csrf = value;
}
