import { requireOptionalNativeModule } from "expo";
export default requireOptionalNativeModule<{
  status(): Promise<{
    available: boolean;
    status: number;
    permissions: string[];
    supported_metrics?: string[];
  }>;
  permissions(metrics: string[]): Promise<string[]>;
  settings(): Promise<void>;
  read(
    metrics: string[],
    timezone: string,
    token: string,
    force: boolean
  ): Promise<Record<string, unknown>>;
}>("OmnixHealth");
