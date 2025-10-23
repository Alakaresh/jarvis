const WARNING_MESSAGE =
  "@picovoice/web-voice-processor n'est pas installé. Le traitement audio du réveil est désactivé.";

if (typeof console !== "undefined" && typeof console.warn === "function") {
  console.warn(WARNING_MESSAGE);
}

export const WebVoiceProcessor = null;

export default {
  WebVoiceProcessor,
};
