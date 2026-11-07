export const localModels = [
  {
    id: "qwen3",
    name: "Qwen3 · 0.6B",
    description: "Balanced · 580–630 MB",
    repository: "onnx-community/Qwen3-0.6B-ONNX",
    revision: "58ca03a5e7b354b480b1a82b34bde8dc7b854cc0",
    cache: "omnix-ai-qwen3-06b-v1",
    download: "about 580 MB on GPU or 630 MB on CPU"
  },
  {
    id: "smollm2",
    name: "SmolLM2 · 135M",
    description: "Compact · 140 MB",
    repository: "onnx-community/SmolLM2-135M-Instruct-ONNX",
    revision: "b8a5c0f183b78c55955a5364f610c36668b5e681",
    cache: "omnix-smollm2-v1",
    download: "about 140 MB"
  }
] as const;
export type ModelId = (typeof localModels)[number]["id"];
export const defaultModel = localModels[0];
