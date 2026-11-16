import { api, qc, type User } from "./api";
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void };
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
    window.addEventListener("omnix-push", receive);
    window.ReactNativeWebView!.postMessage(
      JSON.stringify({ type: "omnix-push-register", silent, firebase })
    );
  });
}
export async function disablePush(id: string) {
  await api("/notifications/devices/" + encodeURIComponent(id), {
    method: "DELETE"
  });
}
