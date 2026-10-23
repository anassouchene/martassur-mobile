#!/bin/bash
set -e

BASE_DIR="/www/wwwroot/SMARTASSUR_MOBILE"

echo "=== Démarrage de SmartAssur Mobile V3 ==="

# Arrêt des processus existants sur les ports 5050 et 3050 si présents
fuser -k 5050/tcp 2>/dev/null || true
fuser -k 3050/tcp 2>/dev/null || true
sleep 1

# 1. Start ASP.NET Core Backend
echo "-> Démarrage Backend ASP.NET Core sur le port 5050..."
cd "$BASE_DIR/backend"
nohup dotnet run --no-build > /var/log/smartassur-backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend démarré (PID $BACKEND_PID)"

# Wait for backend port
until nc -z 127.0.0.1 5050 2>/dev/null; do
  sleep 0.5
done
echo "Backend opérationnel sur http://localhost:5050"

# 2. Start Next.js Frontend
echo "-> Démarrage Frontend Next.js sur le port 3050..."
cd "$BASE_DIR/frontend"
nohup npm start > /var/log/smartassur-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend démarré (PID $FRONTEND_PID)"

until nc -z 127.0.0.1 3050 2>/dev/null; do
  sleep 0.5
done
echo "Frontend opérationnel sur http://localhost:3050"

echo "============================================="
echo "  SmartAssur Mobile V3 est prêt et en ligne ! "
echo "  Application Web : http://localhost:3050      "
echo "  Espace Admin    : http://localhost:3050/admin "
echo "  API Backend     : http://localhost:5050      "
echo "  Documentation   : http://localhost:5050/swagger"
echo "============================================="

