function rand(prefix: string, bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export const projectId = (): string => rand("proj");
export const errorId = (): string => rand("err");
export const projectKey = (): string => rand("pk_live");
// 256 bits — used as the per-project bearer secret on every /api/* call.
export const projectSecret = (): string => rand("sk_live", 32);
