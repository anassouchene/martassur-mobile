#!/bin/bash
set -e

echo "=== Arrêt des services SmartAssur Mobile V3 ==="
fuser -k 5050/tcp 2>/dev/null || true
fuser -k 3050/tcp 2>/dev/null || true
echo "Services arrêtés."

