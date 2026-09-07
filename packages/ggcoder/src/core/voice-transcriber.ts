// Moved to @abukhaled/gg-core. Shim keeps `../core/voice-transcriber.js`
// imports working.
export {
  setProgressCallback,
  resample,
  downmixToMono,
  decodeOggOpus,
  isModelLoaded,
  transcribeVoice,
  type ProgressCallback,
} from "@abukhaled/gg-core";
