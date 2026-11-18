import { api, qc, type User } from "./api";
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void };
    omnixNativeSend?: (data: Record<string, unknown>) => void;
    omnixNativeCapabilities?: readonly string[];
  }
}
export async function enablePush(
  silent = false,
  expectedUser = qc.getQueryData<User>(["me"])?.id
): Promise<string> {
  if (!window.ReactNativeWebView)
    throw new Error(
      "Push notifications are available in the Android companion app."
    );
  const firebase = await api("/settings/firebase/client");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Update the companion app and try again."));
    }, 45000);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("omnix-push", receive);
      window.removeEventListener("omnix-native-ready", ready);
    }
    async function receive(event: Event) {
      cleanup();
      const data = (event as CustomEvent).detail;
      if (data.error) return reject(new Error(data.error));
      if (!expectedUser || qc.getQueryData<User>(["me"])?.id !== expectedUser)
        return reject(
          new Error("Your account changed. Enable notifications again.")
        );
      try {
        const device = await api("/notifications/devices", {
          method: "POST",
          body: JSON.stringify({ kind: "fcm", endpoint: data.token })
        });
        resolve(device.id);
      } catch (error) {
        reject(error);
      }
    }
    const message = { type: "omnix-push-register", silent, firebase };
    function ready() {
      window.omnixNativeSend?.(message);
    }
    window.addEventListener("omnix-push", receive);
    window.addEventListener("omnix-native-ready", ready);
    sendNative(message);
  });
}
export async function disablePush(id: string) {
  await api("/notifications/devices/" + encodeURIComponent(id), {
    method: "DELETE"
  });
}

export function sendNative(message: Record<string, unknown>) {
  if (window.omnixNativeSend) window.omnixNativeSend(message);
  else window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}
