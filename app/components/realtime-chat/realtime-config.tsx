import { RealtimeConfig } from "@/app/store";

import { ServiceProvider } from "@/app/constant";

const providers = [ServiceProvider.OpenAI, ServiceProvider.Azure];

const models = ["gpt-4o-realtime-preview-2024-10-01"];

const voice = ["alloy", "shimmer", "echo"];

export function RealtimeConfigList(props: {
  realtimeConfig: RealtimeConfig;
  updateConfig: (updater: (config: RealtimeConfig) => void) => void;
}) {
  return null;
}
