#!/usr/bin/env bash
# impl: generic
# No-op for projects with no user-visible UI (libraries, pure backends, CLIs).
# Exits non-zero to make it loud if an agent installs this and then tries to use it.
echo "visual: this project has no visible UI to capture (library / backend / CLI)." >&2
echo "Consider: http (API probe), cli_io (CLI probe), runtime_logs, test, or build." >&2
exit 2
