const ignoredDirectories = new Set([
  ".git",
  ".bun",
  ".cache",
  ".vite",
  "node_modules",
  "dist",
  "coverage",
]);

const rules: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "OpenAI-style API key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    name: "Private key block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{80,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "Embedded URL credentials",
    pattern: /https?:\/\/[^/@\s]+:[^/@\s]+@/g,
  },
  {
    name: "Long credential assignment",
    pattern: /\b(?:client_secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password)\b\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,}["']/gi,
  },
];

const glob = new Bun.Glob("**/*");
const findings: Array<{ path: string; rule: string }> = [];

for await (const path of glob.scan({ cwd: process.cwd(), dot: true, onlyFiles: true })) {
  const segments = path.split("/");
  if (segments.some((segment) => ignoredDirectories.has(segment))) continue;

  const file = Bun.file(path);
  if (file.size > 5_000_000) continue;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.subarray(0, 8_192).includes(0)) continue;
  const contents = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(contents)) findings.push({ path, rule: rule.name });
  }
}

if (findings.length > 0) {
  console.error("Potential secrets detected:");
  for (const finding of findings) console.error(`- ${finding.path}: ${finding.rule}`);
  process.exit(1);
}

console.info("Secret scan passed: no high-confidence credentials detected.");
