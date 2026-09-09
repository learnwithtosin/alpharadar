// Bot connection/linking flow and the NFT/token message templates
// (docs/spec/03-CLAUDE-BUILD-PROMPT.md "Telegram templates"). Command
// handlers are pure request-in/reply-out functions, transport-agnostic —
// dispatchUpdate connects them to a raw TelegramUpdate regardless of
// whether it arrived via long-polling (apps/pipeline/src/dev/bot.ts) or,
// later, a webhook.

export { TelegramClient } from "./client.js";
export type {
  InlineKeyboardButton,
  SendMessageParams,
  SendMessageResult,
  TelegramClientOptions,
  TelegramUpdate,
} from "./client.js";
export { TelegramApiError } from "./errors.js";
export { dispatchUpdate, parseCommand } from "./dispatch.js";
export type { DispatchConfig } from "./dispatch.js";
export { looksLikePubliclyReachableHttpsUrl } from "./url-guard.js";

export { handleStart } from "./commands/start.js";
export type { StartInput } from "./commands/start.js";
export { handleSettings } from "./commands/settings.js";
export type { SettingsInput } from "./commands/settings.js";
export { handleStop } from "./commands/stop.js";
export type { StopInput } from "./commands/stop.js";
export type { CommandResult } from "./commands/types.js";

export {
  deriveNftMintAlertReasons,
  renderNftMintAlertMessage,
} from "./templates/nft-mint-alert.js";
export type { NftMintAlertInput, NftMintAlertReasonInputs } from "./templates/nft-mint-alert.js";
export { renderTokenAlertMessage } from "./templates/token-alert.js";
export type { TokenAlertInput } from "./templates/token-alert.js";
