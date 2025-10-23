const WARNING_MESSAGE =
  "@picovoice/porcupine-web-en-worker n'est pas installé. Le réveil par mot-clé Porcupine est désactivé.";

if (typeof console !== "undefined" && typeof console.warn === "function") {
  console.warn(WARNING_MESSAGE);
}

export const PorcupineWorkerFactory = null;
export const PorcupineKeyword = null;
export const PorcupineKeywords = null;
export const BuiltInKeyword = null;
export const BuiltInKeywords = null;

export default {
  PorcupineWorkerFactory,
  PorcupineKeyword,
  PorcupineKeywords,
  BuiltInKeyword,
  BuiltInKeywords,
};
