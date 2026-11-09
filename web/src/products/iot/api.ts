type Capability = {
  type: string;
  instance: string;
  parameters: {
    dataType: string;
    options?: { name: string; value: unknown }[];
    range?: { min: number; max: number };
  };
};
export type Device = {
  id: string;
  name: string;
  sku: string;
  capabilities: Capability[];
};
export type Command = { instance: string; value: unknown };
export type Rule = {
  id: string;
  name: string;
  device_id: string;
  feed_id: string;
  title_contains: string;
  timing: "start" | "end";
  offset_minutes: number;
  include_all_day: boolean;
  enabled: boolean;
  command: Command;
};
export const controlNames: Record<string, string> = {
  powerSwitch: "Power",
  brightness: "Brightness",
  colorRgb: "Colour",
  colorTemperatureK: "Colour temperature",
  lightScene: "Scene",
  diyScene: "DIY scene",
  snapshot: "Snapshot"
};
export function initialCommand(device?: Device): Command {
  const cap =
    device?.capabilities.find((c) => c.instance === "powerSwitch") ||
    device?.capabilities[0];
  return {
    instance: cap?.instance || "powerSwitch",
    value:
      cap?.parameters.options?.[0]?.value ?? cap?.parameters.range?.min ?? 1
  };
}
