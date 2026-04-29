import { spawn, spawnSync } from "node:child_process";
import { createReadStream, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * Whisper transcription backends. Tries local whisper.cpp first (free, fast,
 * private), falls back to the OpenAI API if the binary isn't installed.
 *
 * Both backends normalize to the same shape:
 *   { language, duration, segments: [{ start, end, text }] }
 *
 * Word-level timestamps are optional. When `wordTimestamps: true`:
 *   - whisper.cpp uses `--max-len 1` to force one-word segments + `-ml 1`
 *   - OpenAI verbose_json with `timestamp_granularities[]=word` returns words
 * Both populate `words?: TranscriptWord[]` per segment when supported. When
 * unsupported (older whisper.cpp build) the field is omitted; agents check.
 */

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** Word-level timing if requested + available. */
  words?: TranscriptWord[];
  /**
   * Speaker label, when present. Populated only when the transcript was
   * produced by a tool that does diarization (whisperx, AssemblyAI, manual).
   * gg-editor's bundled `transcribe` does not produce speaker labels.
   */
  speaker?: string;
}

export interface Transcript {
  language: string;
  durationSec: number;
  segments: TranscriptSegment[];
}

export interface TranscribeOptions {
  /** Force a backend; otherwise auto-pick (whisperx if diarize=true, else local first, then api). */
  backend?: "local" | "api" | "whisperx";
  /** Local whisper.cpp model file. Required if backend=local. */
  modelPath?: string;
  /** OpenAI API key (env OPENAI_API_KEY otherwise). */
  apiKey?: string;
  /** OpenAI model id (default: whisper-1). */
  apiModel?: string;
  /** ISO-639-1 language code; whisper auto-detects when omitted. */
  language?: string;
  /** Request word-level timestamps. Required for word-by-word burned captions. */
  wordTimestamps?: boolean;
  /**
   * Run speaker diarization. Requires the `whisperx` CLI on PATH and a Hugging
   * Face token in HF_TOKEN (whisperx uses pyannote, which gates the model behind
   * a free HF account). Output transcripts include `speaker` per segment.
   */
  diarize?: boolean;
  /** HF token override (otherwise reads HF_TOKEN env). Used by whisperx --hf_token. */
  hfToken?: string;
  /** whisperx model size. Default "base". */
  whisperxModel?: string;
  /** Abort signal. */
  signal?: AbortSignal;
}

// ── Backend detection ───────────────────────────────────────

export function detectLocalWhisper(): { cmd: string; argsPrefix: string[] } | undefined {
  // whisper.cpp ships under several names depending on build:
  //   - whisper-cli (modern)
  //   - main (legacy whisper.cpp build artifact)
  //   - whisper (some distros)
  for (const cmd of ["whisper-cli", "whisper", "main"]) {
    const r = spawnSync(cmd, ["--help"], { encoding: "utf8" });
    if (r.status === 0 && (r.stdout + r.stderr).toLowerCase().includes("whisper")) {
      return { cmd, argsPrefix: [] };
    }
  }
  return undefined;
}

/**
 * Detect whisperx (the diarization-capable wrapper around whisper). It prints
 * its name in --help; we accept either way it might be exposed.
 */
export function detectWhisperx(): boolean {
  const r = spawnSync("whisperx", ["--help"], { encoding: "utf8" });
  return r.status === 0;
}

export function detectApiKey(override?: string): string | undefined {
  return override ?? process.env.OPENAI_API_KEY;
}

// ── Public dispatcher ───────────────────────────────────────

export async function transcribe(
  inputPath: string,
  opts: TranscribeOptions = {},
): Promise<Transcript> {
  const wantLocal = opts.backend === "local";
  const wantApi = opts.backend === "api";
  const wantWhisperx = opts.backend === "whisperx" || opts.diarize === true;

  if (wantWhisperx) {
    if (!detectWhisperx()) {
      throw new Error(
        "whisperx not on PATH. Install: pip install whisperx. " +
          "Diarization also requires HF_TOKEN (free account at huggingface.co).",
      );
    }
    return transcribeWhisperx(inputPath, opts);
  }

  if (!wantApi) {
    const local = detectLocalWhisper();
    if (local && opts.modelPath) {
      return transcribeLocal(inputPath, local.cmd, opts);
    }
    if (wantLocal) {
      throw new Error(
        "whisper.cpp not found or modelPath not set. " +
          "Install whisper.cpp and pass modelPath to ggml-*.bin.",
      );
    }
  }

  const apiKey = detectApiKey(opts.apiKey);
  if (!apiKey) {
    throw new Error(
      "No transcription backend available. " +
        "Either install whisper.cpp + pass modelPath, or set OPENAI_API_KEY.",
    );
  }
  return transcribeOpenAI(inputPath, apiKey, opts);
}

// ── Local: whisper.cpp ──────────────────────────────────────

function transcribeLocal(
  inputPath: string,
  cmd: string,
  opts: TranscribeOptions,
): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    if (!opts.modelPath) {
      reject(new Error("modelPath required for local whisper backend"));
      return;
    }
    const args = [
      "-m",
      opts.modelPath,
      "-f",
      inputPath,
      "-oj", // output JSON
      "-of",
      "/dev/stdout", // some builds ignore -of stdout; we re-derive from stderr if needed
      "-pp", // print progress
      "-nt", // no timestamps in printed text
    ];
    if (opts.language) args.push("-l", opts.language);
    if (opts.wordTimestamps) {
      // whisper.cpp emits per-token timestamps in the JSON when -ml=1 forces
      // single-token segments. We post-process to lift them onto words.
      args.push("-ml", "1");
    }

    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper.cpp exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        // whisper.cpp -oj writes a JSON file alongside the input by default;
        // when -of /dev/stdout is honoured, JSON is in stdout. Try both.
        const json = stdout.trim().startsWith("{") ? stdout : (extractJsonBlock(stdout) ?? stderr);
        const parsed = JSON.parse(json) as {
          result?: { language?: string };
          transcription?: Array<{ offsets: { from: number; to: number }; text: string }>;
        };
        const tokens = parsed.transcription ?? [];
        const segments = opts.wordTimestamps
          ? regroupTokensIntoSegments(tokens)
          : tokens.map((t) => ({
              start: t.offsets.from / 1000,
              end: t.offsets.to / 1000,
              text: t.text.trim(),
            }));
        resolve({
          language: parsed.result?.language ?? opts.language ?? "unknown",
          durationSec: tokens[tokens.length - 1]?.offsets.to
            ? tokens[tokens.length - 1].offsets.to / 1000
            : 0,
          segments,
        });
      } catch (e) {
        reject(new Error(`failed to parse whisper.cpp JSON: ${(e as Error).message}`));
      }
    });
  });
}

function extractJsonBlock(s: string): string | undefined {
  const open = s.indexOf("{");
  const close = s.lastIndexOf("}");
  if (open >= 0 && close > open) return s.slice(open, close + 1);
  return undefined;
}

/**
 * whisper.cpp with -ml=1 emits ONE entry per token. We regroup adjacent tokens
 * back into sentence-ish segments (split at sentence punctuation) and attach
 * the original tokens as the `words` array.
 */
export function regroupTokensIntoSegments(
  tokens: Array<{ offsets: { from: number; to: number }; text: string }>,
): TranscriptSegment[] {
  if (tokens.length === 0) return [];
  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current
        .map((w) => w.text)
        .join(" ")
        .replace(/\s+([.,!?;:])/g, "$1")
        .trim(),
      words: current,
    });
    current = [];
  };
  for (const t of tokens) {
    const txt = t.text.trim();
    if (!txt) continue;
    current.push({ start: t.offsets.from / 1000, end: t.offsets.to / 1000, text: txt });
    if (/[.!?]$/.test(txt)) flush();
  }
  flush();
  return segments;
}

// ── whisperx (diarization) ───────────────────────────

export interface WhisperxJson {
  language?: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
    words?: Array<{ start: number; end: number; word: string; speaker?: string }>;
  }>;
}

/**
 * Pure-data conversion: whisperx JSON shape → our Transcript shape.
 * Exposed for unit tests; production code reads the file from disk first.
 */
export function whisperxJsonToTranscript(
  parsed: WhisperxJson,
  fallbackLanguage = "unknown",
): Transcript {
  const segments: TranscriptSegment[] = (parsed.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
    ...(s.speaker ? { speaker: s.speaker } : {}),
    ...(s.words && s.words.length > 0
      ? {
          words: s.words
            .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
            .map((w) => ({
              start: w.start,
              end: w.end,
              text: w.word.trim(),
            })),
        }
      : {}),
  }));
  return {
    language: parsed.language ?? fallbackLanguage,
    durationSec: segments.at(-1)?.end ?? 0,
    segments,
  };
}

function transcribeWhisperx(inputPath: string, opts: TranscribeOptions): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    const outDir = mkdtempSync(join(tmpdir(), "gg-editor-whisperx-"));
    const args = [
      inputPath,
      "--model",
      opts.whisperxModel ?? "base",
      "--output_format",
      "json",
      "--output_dir",
      outDir,
    ];
    if (opts.diarize) args.push("--diarize");
    if (opts.language) args.push("--language", opts.language);
    const hfToken = opts.hfToken ?? process.env.HF_TOKEN;
    if (opts.diarize) {
      if (!hfToken) {
        reject(
          new Error(
            "HF_TOKEN required for diarization. Get one free at huggingface.co/settings/tokens " +
              "and accept the pyannote/speaker-diarization-3.1 license.",
          ),
        );
        return;
      }
      args.push("--hf_token", hfToken);
    }

    const child = spawn("whisperx", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisperx exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        // whisperx writes <basename>.json into outDir.
        const files = readdirSync(outDir).filter((f) => f.endsWith(".json"));
        if (files.length === 0) {
          reject(new Error("whisperx produced no JSON output"));
          return;
        }
        const parsed = JSON.parse(readFileSync(join(outDir, files[0]), "utf8")) as WhisperxJson;
        resolve(whisperxJsonToTranscript(parsed, opts.language ?? "unknown"));
      } catch (e) {
        reject(new Error(`failed to parse whisperx JSON: ${(e as Error).message}`));
      }
    });
  });
}

// ── OpenAI API ──────────────────────────────────────────────

interface OpenAITranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: Array<{ start: number; end: number; word: string }>;
}

async function transcribeOpenAI(
  inputPath: string,
  apiKey: string,
  opts: TranscribeOptions,
): Promise<Transcript> {
  const stat = statSync(inputPath);
  if (stat.size > 25 * 1024 * 1024) {
    throw new Error(
      `OpenAI transcription file size limit is 25MB (got ${(stat.size / 1024 / 1024).toFixed(1)}MB). ` +
        "Compress audio first (e.g. mono 16kHz WAV via extract_audio).",
    );
  }

  // Build multipart body manually — keeps the package dep-free (no axios/form-data).
  const boundary = `----gg-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const model = opts.apiModel ?? "whisper-1";
  const fileBuf = await streamToBuffer(createReadStream(inputPath));
  const fileName = basename(inputPath);

  const parts: (string | Buffer)[] = [];
  const push = (s: string) => parts.push(s);
  push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`);
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`,
  );
  if (opts.wordTimestamps) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`,
    );
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment\r\n`,
    );
  }
  if (opts.language) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${opts.language}\r\n`,
    );
  }
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  parts.push(fileBuf);
  push(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat(
    parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : p)),
  );

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: opts.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI transcription HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as OpenAITranscriptionResponse;
  const segments = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  })) as TranscriptSegment[];
  if (opts.wordTimestamps && data.words && segments.length > 0) {
    // Distribute words into the segment whose [start,end] contains the word's
    // midpoint. Linear walk; both arrays are already in order.
    let segIdx = 0;
    for (const w of data.words) {
      const mid = (w.start + w.end) / 2;
      while (segIdx < segments.length - 1 && mid > segments[segIdx].end) segIdx += 1;
      const seg = segments[segIdx];
      if (!seg.words) seg.words = [];
      seg.words.push({ start: w.start, end: w.end, text: w.word });
    }
  }
  return {
    language: data.language ?? opts.language ?? "unknown",
    durationSec: data.duration ?? 0,
    segments,
  };
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
