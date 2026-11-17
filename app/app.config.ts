import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const preview = process.env.EXPO_PUBLIC_OMNIX_CHANNEL !== "production";
  return {
    ...config,
    name: preview ? "Omnix Preview" : "Omnix",
    slug: "omnix-companion",
    scheme: preview ? "omnix-preview" : "omnix",
    plugins: [
      ...(config.plugins || []),
      "expo-notifications",
      "./plugins/withRuntimeFirebase.cjs"
    ],
    android: {
      ...config.android,
      package: preview ? "com.bizbazboz.omnix.preview" : "com.bizbazboz.omnix",
      intentFilters: preview
        ? []
        : [
            {
              action: "VIEW",
              autoVerify: true,
              category: ["BROWSABLE", "DEFAULT"],
              data: [
                { scheme: "https", host: "omnix.bizbazboz.uk", path: "/" },
                ...[
                  "email",
                  "calendar",
                  "health",
                  "notes",
                  "daily",
                  "iot",
                  "settings",
                  "onboarding"
                ].flatMap((section) => [
                  {
                    scheme: "https",
                    host: "omnix.bizbazboz.uk",
                    path: "/" + section
                  },
                  {
                    scheme: "https",
                    host: "omnix.bizbazboz.uk",
                    pathPrefix: "/" + section + "/"
                  }
                ])
              ]
            }
          ]
    },
    ios: {
      ...config.ios,
      bundleIdentifier: preview
        ? "uk.bizbazboz.omnix.preview"
        : "uk.bizbazboz.omnix"
    }
  };
};
