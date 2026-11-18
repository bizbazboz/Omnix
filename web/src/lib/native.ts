import { sendNative } from "./push";
export function nativeRequest<T>(
  type: string,
  values: Record<string, unknown> = {},
  timeout = 120000
): Promise<T> {
  if (!window.ReactNativeWebView || !window.omnixNativeSend)
    return Promise.reject(Error("Update the companion to use this feature."));
  const capability =
    type === "omnix-export-gpx" ? "export-gpx" : "health-connect";
  if (!window.omnixNativeCapabilities?.includes(capability))
    return Promise.reject(Error("Update the companion to use this feature."));
  const request_id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("omnix-native-result", receive);
    };
    const receive = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (value?.request_id !== request_id) return;
      finish();
      value.error ? reject(Error(value.error)) : resolve(value.result as T);
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        Error("The device did not respond. Return to Omnix and try again.")
      );
    }, timeout);
    window.addEventListener("omnix-native-result", receive);
    sendNative({ type, request_id, ...values });
  });
}
