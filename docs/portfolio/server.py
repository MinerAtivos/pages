#!/usr/bin/env python3
"""
B3 Rebalanceamento & IA — Flask Web Server
Serves the frontend and exposes API endpoints for portfolio analysis.
"""

import json
import os
import sqlite3
import traceback
from datetime import datetime

import numpy as np
from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = BASE_DIR
DATA_DIR = os.path.join(BASE_DIR, "data")
ASSETS_FILE = os.path.join(BASE_DIR, "assets.json")
PORTFOLIO_FILE = os.path.join(BASE_DIR, "sample_portfolio.json")

app = Flask(__name__, static_folder=STATIC_DIR)
app.secret_key = os.environ.get("SECRET_KEY", "b3-rebalancing-secret-key-12345")

os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "app.db")


# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE NOT NULL,
                  password_hash TEXT NOT NULL,
                  is_admin INTEGER DEFAULT 0)''')
    c.execute('''CREATE TABLE IF NOT EXISTS portfolios
                 (user_id INTEGER PRIMARY KEY,
                  data TEXT NOT NULL,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY(user_id) REFERENCES users(id))''')

    # Create default admin if no users exist
    c.execute("SELECT COUNT(*) FROM users")
    if c.fetchone()[0] == 0:
        admin_pass = generate_password_hash("admin123")
        c.execute("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
                  ("admin", admin_pass, 1))
        print("Default admin user created: admin / admin123")

    conn.commit()
    conn.close()


init_db()


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _load_json(path, default=None):
    """Safely load a JSON file."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, data):
    """Save data as JSON."""
    os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)




# ---------------------------------------------------------------------------
# Example / fallback market data (used when yfinance is unavailable)
# ---------------------------------------------------------------------------
EXAMPLE_MARKET_DATA = {
    "timestamp": datetime.now().isoformat(),
    "assets": {
        "PETR4.SA": {
            "ticker": "PETR4.SA",
            "name": "Petrobras",
            "sector": "Energia",
            "last_price": 38.72,
            "dividends": {"dates": ["2024-06-01", "2024-12-01"], "values": [1.55, 1.80]},
            "history": {
                "dates": ["2024-01-02", "2024-04-01", "2024-07-01", "2024-10-01", "2025-01-02"],
                "closes": [36.50, 37.10, 38.00, 37.80, 38.72],
                "volumes": [12000000, 11500000, 13000000, 12800000, 11200000],
            },
            "stats": {"avg_price": 37.62, "min_price": 33.10, "max_price": 42.15, "volatility": 2.41},
        },
        "VALE3.SA": {
            "ticker": "VALE3.SA",
            "name": "Vale",
            "sector": "Mineração",
            "last_price": 58.90,
            "dividends": {"dates": ["2024-03-15", "2024-09-15"], "values": [2.10, 1.95]},
            "history": {
                "dates": ["2024-01-02", "2024-04-01", "2024-07-01", "2024-10-01", "2025-01-02"],
                "closes": [62.30, 60.50, 57.80, 59.10, 58.90],
                "volumes": [9500000, 10200000, 9800000, 10500000, 9300000],
            },
            "stats": {"avg_price": 59.72, "min_price": 54.20, "max_price": 68.50, "volatility": 1.87},
        },
        "ITUB4.SA": {
            "ticker": "ITUB4.SA",
            "name": "Itaú Unibanco",
            "sector": "Financeiro",
            "last_price": 34.15,
            "dividends": {"dates": ["2024-06-01", "2024-12-01"], "values": [0.85, 0.92]},
            "history": {
                "dates": ["2024-01-02", "2024-04-01", "2024-07-01", "2024-10-01", "2025-01-02"],
                "closes": [31.20, 32.50, 33.10, 33.80, 34.15],
                "volumes": [14000000, 13500000, 14200000, 13800000, 13200000],
            },
            "stats": {"avg_price": 32.95, "min_price": 28.50, "max_price": 35.20, "volatility": 2.05},
        },
        "BBDC4.SA": {
            "ticker": "BBDC4.SA",
            "name": "Bradesco",
            "sector": "Financeiro",
            "last_price": 14.80,
            "dividends": {"dates": ["2024-06-01", "2024-12-01"], "values": [0.42, 0.45]},
            "history": {
                "dates": ["2024-01-02", "2024-04-01", "2024-07-01", "2024-10-01", "2025-01-02"],
                "closes": [15.20, 14.90, 14.50, 14.60, 14.80],
                "volumes": [18000000, 17500000, 16800000, 17200000, 16500000],
            },
            "stats": {"avg_price": 14.80, "min_price": 12.10, "max_price": 16.50, "volatility": 2.32},
        },
        "ABEV3.SA": {
            "ticker": "ABEV3.SA",
            "name": "Ambev",
            "sector": "Consumo",
            "last_price": 11.95,
            "dividends": {"dates": ["2024-04-01", "2024-10-01"], "values": [0.35, 0.38]},
            "history": {
                "dates": ["2024-01-02", "2024-04-01", "2024-07-01", "2024-10-01", "2025-01-02"],
                "closes": [12.80, 12.30, 11.90, 12.10, 11.95],
                "volumes": [22000000, 21500000, 20800000, 21200000, 20500000],
            },
            "stats": {"avg_price": 12.21, "min_price": 10.80, "max_price": 13.50, "volatility": 1.65},
        },
        "WEGE3.SA": {
            "ticker": "WEGE3.SA",
            "name": "WEG",
            "sector": "Indústria",
            "last_price": 52.40,
            "dividends": {"dates": ["2024-05-01", "2024-11-01"], "values": [0.28, 0.31]},
            "history": {
                "dates": ["2024-01-02", "2024-04-01", "2024-07-01", "2024-10-01", "2025-01-02"],
                "closes": [38.50, 42.10, 45.80, 49.20, 52.40],
                "volumes": [5500000, 5800000, 6200000, 5900000, 6100000],
            },
            "stats": {"avg_price": 45.60, "min_price": 35.20, "max_price": 54.80, "volatility": 1.92},
        },
    },
}


# ---------------------------------------------------------------------------
# Static file routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path)


# ---------------------------------------------------------------------------
# API — Auth
# ---------------------------------------------------------------------------
@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "Usuário e senha obrigatórios"}), 400

    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()

    if user and check_password_hash(user["password_hash"], password):
        session.clear()
        session["user_id"] = user["id"]
        session["username"] = user["username"]
        session["is_admin"] = bool(user["is_admin"])
        return jsonify({
            "message": "Login realizado com sucesso",
            "username": user["username"],
            "is_admin": bool(user["is_admin"])
        })

    return jsonify({"error": "Usuário ou senha inválidos"}), 401


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logout realizado com sucesso"})


@app.route("/api/auth/status")
def auth_status():
    if "user_id" in session:
        return jsonify({
            "logged_in": True,
            "username": session["username"],
            "is_admin": session.get("is_admin", False)
        })
    return jsonify({"logged_in": False})


@app.route("/api/auth/change-password", methods=["POST"])
def change_password():
    if "user_id" not in session:
        return jsonify({"error": "Não autorizado"}), 401

    data = request.json
    old_password = data.get("old_password")
    new_password = data.get("new_password")

    if not old_password or not new_password:
        return jsonify({"error": "Senhas antiga e nova são obrigatórias"}), 400

    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()

    if user and check_password_hash(user["password_hash"], old_password):
        new_hash = generate_password_hash(new_password)
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, session["user_id"]))
        conn.commit()
        conn.close()
        return jsonify({"message": "Senha alterada com sucesso"})

    conn.close()
    return jsonify({"error": "Senha antiga incorreta"}), 400


# ---------------------------------------------------------------------------
# API — Admin
# ---------------------------------------------------------------------------
@app.route("/api/admin/users", methods=["GET"])
def admin_list_users():
    if not session.get("is_admin"):
        return jsonify({"error": "Não autorizado"}), 403

    conn = get_db_connection()
    users = conn.execute("SELECT id, username, is_admin FROM users").fetchall()
    conn.close()
    return jsonify([dict(u) for u in users])


@app.route("/api/admin/users", methods=["POST"])
def admin_add_user():
    if not session.get("is_admin"):
        return jsonify({"error": "Não autorizado"}), 403

    data = request.json
    username = data.get("username")
    password = data.get("password")
    is_admin = 1 if data.get("is_admin") else 0

    if not username or not password:
        return jsonify({"error": "Usuário e senha obrigatórios"}), 400

    conn = get_db_connection()
    try:
        conn.execute("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
                     (username, generate_password_hash(password), is_admin))
        conn.commit()
        return jsonify({"message": f"Usuário {username} criado com sucesso"})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Usuário já existe"}), 400
    finally:
        conn.close()


@app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
def admin_delete_user(user_id):
    if not session.get("is_admin"):
        return jsonify({"error": "Não autorizado"}), 403

    if user_id == session["user_id"]:
        return jsonify({"error": "Você não pode excluir a si mesmo"}), 400

    conn = get_db_connection()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.execute("DELETE FROM portfolios WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Usuário excluído"})


# ---------------------------------------------------------------------------
# API — Portfolio
# ---------------------------------------------------------------------------
@app.route("/api/portfolio", methods=["GET", "POST"])
def manage_portfolio():
    if "user_id" not in session:
        return jsonify({"error": "Não autorizado"}), 401

    user_id = session["user_id"]
    conn = get_db_connection()

    if request.method == "POST":
        portfolio_data = request.json
        if not portfolio_data or not isinstance(portfolio_data, dict):
            return jsonify({"error": "Dados do portfólio inválidos"}), 400

        data_str = json.dumps(portfolio_data)

        # Insert or Replace portfolio
        conn.execute('''INSERT INTO portfolios (user_id, data, updated_at)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(user_id) DO UPDATE SET
                        data = excluded.data,
                        updated_at = CURRENT_TIMESTAMP''', (user_id, data_str))
        conn.commit()
        conn.close()
        return jsonify({"message": "Portfólio salvo com sucesso"})

    else:
        # GET
        row = conn.execute("SELECT data FROM portfolios WHERE user_id = ?", (user_id,)).fetchone()
        conn.close()

        if row:
            return jsonify(json.loads(row["data"]))
        return jsonify({"name": "Meu Portfólio", "positions": [], "is_new": True})


# ---------------------------------------------------------------------------
# API — Leads
# ---------------------------------------------------------------------------
@app.route("/api/leads", methods=["POST"])
def add_lead():
    data = request.json
    email = data.get("email")

    if not email:
        return jsonify({"error": "E-mail obrigatório"}), 400

    # In a real app, we would send an email or save to a database.
    # For now, we will log it and save to a JSON file.
    lead_file = os.path.join(DATA_DIR, "leads.json")
    leads = _load_json(lead_file, [])
    leads.append({
        "email": email,
        "timestamp": datetime.now().isoformat()
    })
    _save_json(lead_file, leads)

    print(f"Novo lead cadastrado: {email} (enviar para minerativos@gmail.com)")

    return jsonify({"message": "Lead cadastrado com sucesso"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  B3 Rebalanceamento & IA — Servidor Web")
    print("  Acesse: http://localhost:5000")
    print("=" * 60 + "\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
