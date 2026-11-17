import { requireOptionalNativeModule } from "expo";
export type FirebaseClient = {
  projectId: string;
  appId: string;
  apiKey: string;
  messagingSenderId: string;
  packageName: string;
};
export default requireOptionalNativeModule<{
  packageName(): string;
  linkStatus(): {
    packageName: string;
    supported: boolean;
    allowed: boolean;
    domains: Record<string, number>;
  };
  configure(config: FirebaseClient, origin: string): Promise<void>;
}>("OmnixFirebase");
