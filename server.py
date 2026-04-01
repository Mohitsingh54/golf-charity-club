import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
APP_DATA_DIR = BASE_DIR / ".data"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = APP_DATA_DIR / "golf_charity.db"
SECRET_PATH = APP_DATA_DIR / ".auth_secret"
ACCESS_TTL_SECONDS = 15 * 60
REFRESH_TTL_DAYS = 14
TOKEN_TTL_HOURS = 1


def utc_now():
    return datetime.now(timezone.utc)


def ensure_secret():
    if SECRET_PATH.exists():
        return SECRET_PATH.read_bytes()

    secret = secrets.token_bytes(32)
    SECRET_PATH.write_bytes(secret)
    return secret


AUTH_SECRET = ensure_secret()


def get_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db():
    connection = get_db()
    cursor = connection.cursor()
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            club TEXT,
            role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            is_email_verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        """
    )
    connection.commit()

    if cursor.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"] == 0:
        seed_user(cursor, "Aarav Sharma", "aarav@example.com", "Bangalore Greens", "user", "subscriber123", True)
        seed_user(cursor, "Maya Iyer", "maya@example.com", "Chennai Lakes", "user", "subscriber123", True)
        seed_user(cursor, "Admin", "admin@golfcharityclub.com", "HQ", "admin", "admin123", True)
        connection.commit()

    connection.close()


def seed_user(cursor, name, email, club, role, password, verified):
    salt = secrets.token_bytes(16)
    password_hash = hash_password(password, salt)
    cursor.execute(
        """
        INSERT INTO users (name, email, club, role, password_hash, password_salt, is_email_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            email.lower(),
            club,
            role,
            password_hash,
            base64.urlsafe_b64encode(salt).decode("utf-8"),
            1 if verified else 0,
            utc_now().isoformat(),
        ),
    )


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310000).hex()


def verify_password(password, encoded_salt, stored_hash):
    salt = base64.urlsafe_b64decode(encoded_salt.encode("utf-8"))
    return hmac.compare_digest(hash_password(password, salt), stored_hash)


def sign_payload(payload):
    body = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8").rstrip("=")
    signature = hmac.new(AUTH_SECRET, body.encode("utf-8"), hashlib.sha256).digest()
    signed = base64.urlsafe_b64encode(signature).decode("utf-8").rstrip("=")
    return f"{body}.{signed}"


def decode_token(token):
    try:
        body, signature = token.split(".")
        expected = base64.urlsafe_b64encode(
            hmac.new(AUTH_SECRET, body.encode("utf-8"), hashlib.sha256).digest()
        ).decode("utf-8").rstrip("=")
        if not hmac.compare_digest(signature, expected):
            return None

        padded = body + "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def create_access_token(user):
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "type": "access",
        "exp": int(time.time()) + ACCESS_TTL_SECONDS,
    }
    return sign_payload(payload)


def issue_refresh_token(connection, user_id):
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    now = utc_now()
    expires_at = now + timedelta(days=REFRESH_TTL_DAYS)
    connection.execute(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (user_id, token_hash, expires_at.isoformat(), now.isoformat()),
    )
    connection.commit()
    return raw


def rotate_refresh_token(connection, refresh_token):
    token_hash = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
    row = connection.execute(
        """
        SELECT refresh_tokens.*, users.id AS user_id, users.name, users.email, users.club, users.role, users.is_email_verified
        FROM refresh_tokens
        JOIN users ON users.id = refresh_tokens.user_id
        WHERE token_hash = ? AND revoked_at IS NULL
        """,
        (token_hash,),
    ).fetchone()
    if not row:
        return None

    if datetime.fromisoformat(row["expires_at"]) < utc_now():
        return None

    connection.execute(
        "UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?",
        (utc_now().isoformat(), row["id"]),
    )
    connection.commit()
    return {
        "user": row,
        "refresh_token": issue_refresh_token(connection, row["user_id"]),
    }


def create_one_time_token(connection, table_name, user_id):
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    now = utc_now()
    expires_at = now + timedelta(hours=TOKEN_TTL_HOURS)
    connection.execute(
        f"INSERT INTO {table_name} (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (user_id, token_hash, expires_at.isoformat(), now.isoformat()),
    )
    connection.commit()
    return raw


def consume_one_time_token(connection, table_name, raw_token):
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    row = connection.execute(
        f"SELECT * FROM {table_name} WHERE token_hash = ? AND used_at IS NULL",
        (token_hash,),
    ).fetchone()
    if not row:
        return None

    if datetime.fromisoformat(row["expires_at"]) < utc_now():
        return None

    connection.execute(
        f"UPDATE {table_name} SET used_at = ? WHERE id = ?",
        (utc_now().isoformat(), row["id"]),
    )
    connection.commit()
    return row["user_id"]


def serialize_user(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "club": row["club"],
        "role": row["role"],
        "isEmailVerified": bool(row["is_email_verified"]),
    }


class AppHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/auth/me":
            self.handle_me()
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        routes = {
            "/api/auth/signup": self.handle_signup,
            "/api/auth/login": self.handle_login,
            "/api/auth/refresh": self.handle_refresh,
            "/api/auth/logout": self.handle_logout,
            "/api/auth/request-email-verification": self.handle_request_email_verification,
            "/api/auth/verify-email": self.handle_verify_email,
            "/api/auth/request-password-reset": self.handle_request_password_reset,
            "/api/auth/reset-password": self.handle_reset_password,
        }
        handler = routes.get(parsed.path)
        if handler:
            handler()
            return
        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_signup(self):
        payload = self.read_json()
        name = str(payload.get("name", "")).strip()
        email = str(payload.get("email", "")).strip().lower()
        club = str(payload.get("club", "")).strip()
        password = str(payload.get("password", ""))

        if not name or not email or not password:
            self.send_json({"error": "Name, email and password are required."}, HTTPStatus.BAD_REQUEST)
            return

        connection = get_db()
        try:
            salt = secrets.token_bytes(16)
            password_hash = hash_password(password, salt)
            cursor = connection.execute(
                """
                INSERT INTO users (name, email, club, role, password_hash, password_salt, is_email_verified, created_at)
                VALUES (?, ?, ?, 'user', ?, ?, 0, ?)
                """,
                (
                    name,
                    email,
                    club,
                    password_hash,
                    base64.urlsafe_b64encode(salt).decode("utf-8"),
                    utc_now().isoformat(),
                ),
            )
            connection.commit()
        except sqlite3.IntegrityError:
            connection.close()
            self.send_json({"error": "Email is already registered."}, HTTPStatus.CONFLICT)
            return

        user = connection.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        verification_token = create_one_time_token(connection, "email_verification_tokens", user["id"])
        refresh_token = issue_refresh_token(connection, user["id"])
        access_token = create_access_token(user)
        connection.close()

        self.send_json({
            "message": "Account created successfully.",
            "user": serialize_user(user),
            "tokens": {"accessToken": access_token, "refreshToken": refresh_token},
            "devEmailVerificationToken": verification_token,
        }, HTTPStatus.CREATED)

    def handle_login(self):
        payload = self.read_json()
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        connection = get_db()
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
            connection.close()
            self.send_json({"error": "Invalid email or password."}, HTTPStatus.UNAUTHORIZED)
            return

        refresh_token = issue_refresh_token(connection, user["id"])
        access_token = create_access_token(user)
        connection.close()
        self.send_json({
            "message": "Login successful.",
            "user": serialize_user(user),
            "tokens": {"accessToken": access_token, "refreshToken": refresh_token},
        })

    def handle_refresh(self):
        payload = self.read_json()
        refresh_token = str(payload.get("refreshToken", ""))
        if not refresh_token:
            self.send_json({"error": "Refresh token is required."}, HTTPStatus.BAD_REQUEST)
            return

        connection = get_db()
        rotated = rotate_refresh_token(connection, refresh_token)
        if not rotated:
            connection.close()
            self.send_json({"error": "Refresh token is invalid or expired."}, HTTPStatus.UNAUTHORIZED)
            return

        user = rotated["user"]
        access_token = create_access_token(user)
        new_refresh_token = rotated["refresh_token"]
        connection.close()
        self.send_json({
            "message": "Token refreshed.",
            "user": serialize_user(user),
            "tokens": {"accessToken": access_token, "refreshToken": new_refresh_token},
        })

    def handle_logout(self):
        payload = self.read_json()
        refresh_token = str(payload.get("refreshToken", ""))
        if refresh_token:
            connection = get_db()
            token_hash = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
            connection.execute(
                "UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
                (utc_now().isoformat(), token_hash),
            )
            connection.commit()
            connection.close()
        self.send_json({"message": "Logged out."})

    def handle_request_email_verification(self):
        payload = self.read_json()
        email = str(payload.get("email", "")).strip().lower()
        connection = get_db()
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            connection.close()
            self.send_json({"message": "If the email exists, a verification token has been created."})
            return

        token = create_one_time_token(connection, "email_verification_tokens", user["id"])
        connection.close()
        self.send_json({
            "message": "Verification token created.",
            "devEmailVerificationToken": token,
        })

    def handle_verify_email(self):
        payload = self.read_json()
        token = str(payload.get("token", "")).strip()
        connection = get_db()
        user_id = consume_one_time_token(connection, "email_verification_tokens", token)
        if not user_id:
            connection.close()
            self.send_json({"error": "Verification token is invalid or expired."}, HTTPStatus.BAD_REQUEST)
            return

        connection.execute("UPDATE users SET is_email_verified = 1 WHERE id = ?", (user_id,))
        connection.commit()
        connection.close()
        self.send_json({"message": "Email verified successfully."})

    def handle_request_password_reset(self):
        payload = self.read_json()
        email = str(payload.get("email", "")).strip().lower()
        connection = get_db()
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            connection.close()
            self.send_json({"message": "If the email exists, a reset token has been created."})
            return

        token = create_one_time_token(connection, "password_reset_tokens", user["id"])
        connection.close()
        self.send_json({
            "message": "Password reset token created.",
            "devPasswordResetToken": token,
        })

    def handle_reset_password(self):
        payload = self.read_json()
        token = str(payload.get("token", "")).strip()
        password = str(payload.get("password", ""))
        if not token or not password:
            self.send_json({"error": "Token and new password are required."}, HTTPStatus.BAD_REQUEST)
            return

        connection = get_db()
        user_id = consume_one_time_token(connection, "password_reset_tokens", token)
        if not user_id:
            connection.close()
            self.send_json({"error": "Password reset token is invalid or expired."}, HTTPStatus.BAD_REQUEST)
            return

        salt = secrets.token_bytes(16)
        connection.execute(
            "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?",
            (
                hash_password(password, salt),
                base64.urlsafe_b64encode(salt).decode("utf-8"),
                user_id,
            ),
        )
        connection.commit()
        connection.close()
        self.send_json({"message": "Password updated successfully."})

    def handle_me(self):
        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            self.send_json({"error": "Missing access token."}, HTTPStatus.UNAUTHORIZED)
            return

        payload = decode_token(auth_header.replace("Bearer ", "", 1))
        if not payload or payload.get("type") != "access":
            self.send_json({"error": "Access token is invalid or expired."}, HTTPStatus.UNAUTHORIZED)
            return

        connection = get_db()
        user = connection.execute("SELECT * FROM users WHERE id = ?", (payload["sub"],)).fetchone()
        connection.close()
        if not user:
            self.send_json({"error": "User not found."}, HTTPStatus.NOT_FOUND)
            return

        self.send_json({"user": serialize_user(user)})

    def serve_static(self, path):
        clean_path = "/" if path in {"", "/"} else path
        if clean_path == "/":
            file_path = BASE_DIR / "index.html"
        else:
            file_path = (BASE_DIR / clean_path.lstrip("/")).resolve()

        if not str(file_path).startswith(str(BASE_DIR)) or not file_path.exists() or file_path.is_dir():
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return

        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }.get(file_path.suffix, "application/octet-stream")
        body = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    initialize_db()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), AppHandler)
    print("Server running on http://127.0.0.1:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
