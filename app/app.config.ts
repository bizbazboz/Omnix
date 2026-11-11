import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const preview = process.env.EXPO_PUBLIC_OMNIX_CHANNEL !== "production";
  return {
    ...config,
    name: "Omnix",
    slug: "omnix-companion",
    scheme: preview ? "omnix-preview" : "omnix",
    android: {
      ...config.android,
      package: preview ? "com.bizbazboz.omnix.preview" : "com.bizbazboz.omnix"
    },
    ios: {
      ...config.ios,
      bundleIdentifier: preview
        ? "uk.bizbazboz.omnix.preview"
        : "uk.bizbazboz.omnix"
    }
  };
};
