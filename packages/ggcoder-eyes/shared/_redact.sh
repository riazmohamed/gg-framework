#!/usr/bin/env bash
# _redact.sh — stdin → stdout, strip obvious secrets from text artifacts.
# Caveat: does nothing for binary artifacts (screenshots, PDFs, audio). Image
# redaction of auth'd UIs is a gap the probe author must handle at capture time
# (e.g. Playwright --mask selectors).
set -eu

exec perl -pe '
  # JWTs
  s/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED_JWT]/g;

  # Provider-specific API keys
  s/\b(sk-ant-api\d+-[A-Za-z0-9_-]+)/[REDACTED_ANTHROPIC]/g;
  s/\b(sk-proj-[A-Za-z0-9_-]+)/[REDACTED_OPENAI]/g;
  s/\b(sk-[A-Za-z0-9]{32,})/[REDACTED_OPENAI]/g;
  s/\b(gh[pousr]_[A-Za-z0-9]{30,})/[REDACTED_GITHUB]/g;
  s/\b(AKIA[0-9A-Z]{16})/[REDACTED_AWS]/g;
  s/\b(xox[abpors]-[A-Za-z0-9-]{10,})/[REDACTED_SLACK]/g;

  # Bearer / Basic tokens in headers
  s/(?i)(authorization\s*:\s*bearer\s+)[A-Za-z0-9_.\-]+/$1[REDACTED]/g;
  s/(?i)(authorization\s*:\s*basic\s+)[A-Za-z0-9+\/=]+/$1[REDACTED]/g;

  # Env-style assignments for anything whose name looks secret-y
  s/(\w*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|PRIVATE)\w*)\s*[=:]\s*[^\s;,&"\x27]+/$1=[REDACTED]/gi;

  # Cookie: whole value
  s/(?i)(cookie\s*:\s*)[^\r\n]+/$1[REDACTED_COOKIE]/g;
'
