#!/usr/bin/env python3
"""Crée ou réinitialise un compte de l'espace gestionnaire SmartAssur.

Usage : PGPASSWORD=... python3 database/create_admin.py <identifiant> "<Nom affiché>" [ADMIN|GESTIONNAIRE]
Le mot de passe est généré aléatoirement et affiché une seule fois.
Format du hash identique à backend/Services/AdminPasswordHasher.cs.
"""
import base64
import hashlib
import os
import secrets
import subprocess
import sys

ITERATIONS = 210_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, 32)
    return f"pbkdf2_sha256${ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    if len(sys.argv) < 3 or "PGPASSWORD" not in os.environ:
        sys.exit(__doc__)
    username = sys.argv[1].strip().lower()
    display_name = sys.argv[2].strip()
    role = (sys.argv[3] if len(sys.argv) > 3 else "GESTIONNAIRE").upper()
    if role not in ("ADMIN", "GESTIONNAIRE"):
        sys.exit("Rôle invalide : ADMIN ou GESTIONNAIRE")

    password = secrets.token_urlsafe(12)
    sql = (
        "INSERT INTO admin_users (username, display_name, password_hash, role) VALUES "
        f"({sql_literal(username)}, {sql_literal(display_name)}, {sql_literal(hash_password(password))}, {sql_literal(role)}) "
        "ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, "
        "display_name = EXCLUDED.display_name, role = EXCLUDED.role, is_active = TRUE;"
    )
    subprocess.run(
        ["psql", "-h", os.environ.get("SMARTASSUR_DB_HOST", "127.0.0.1"), "-U", os.environ.get("SMARTASSUR_DB_USER", "smartassur"),
         "-d", os.environ.get("SMARTASSUR_DB_NAME", "smartassur_db"), "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
        check=True,
    )
    print(f"Compte {username} ({role}) prêt. Mot de passe : {password}")


if __name__ == "__main__":
    main()
