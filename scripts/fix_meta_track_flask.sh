#!/bin/bash
# Restore flask for meta-track (CAPI proxy) — approved by Master 2026-08-27
set -e
/usr/bin/python3 -m pip install --break-system-packages flask requests 2>&1 | tail -3
/usr/bin/python3 -c "import flask; print('flask OK', flask.__version__)"
