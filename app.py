"""SkillUp Flask backend: SQLite database + session-cookie login (no external services except Gemini).
Run: python app.py   |   Production: waitress-serve --port=8000 app:app"""
import json, logging, os, re, secrets, sqlite3, time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, g, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash
import recommend, roadmap_service as rs

load_dotenv(Path(__file__).with_name(".env"))
log = logging.getLogger("skillup")
logging.basicConfig(level=logging.INFO)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SQLiteStore:
    """Users and roadmaps. Every roadmap query includes the owner's uid, so users cannot reach each other's data."""
    def __init__(self, path):
        self.path = path
        self._q("""CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', pw_hash TEXT NOT NULL, created_at TEXT NOT NULL)""")
        user_columns = {row["name"] for row in self._q("PRAGMA table_info(users)")[0]}
        if "name" not in user_columns:
            self._q("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''")
        self._q("""CREATE TABLE IF NOT EXISTS roadmaps(id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)""")

    def _q(self, sql, args=()):
        c = sqlite3.connect(self.path); c.row_factory = sqlite3.Row
        try:
            cur = c.execute(sql, args); rows = cur.fetchall(); c.commit()
            return rows, cur.lastrowid, cur.rowcount
        finally: c.close()

    def add_user(self, email, name, pw_hash):
        try: return self._q("INSERT INTO users(email,name,pw_hash,created_at) VALUES(?,?,?,?)", (email, name, pw_hash, _now()))[1]
        except sqlite3.IntegrityError: return None
    def set_name(self, uid, name):
        return self._q("UPDATE users SET name=? WHERE id=?", (name, uid))[2] > 0
    def user_by_email(self, email):
        r = self._q("SELECT * FROM users WHERE email=?", (email,))[0]; return dict(r[0]) if r else None
    def user_by_id(self, uid):
        r = self._q("SELECT * FROM users WHERE id=?", (uid,))[0]; return dict(r[0]) if r else None

    @staticmethod
    def _row(r): d = json.loads(r["data"]); d.update(id=str(r["id"]), created_at=r["created_at"]); return d
    @staticmethod
    def _id(rid):
        try: return int(rid)
        except (TypeError, ValueError): return None
    def list(self, uid): return [self._row(r) for r in self._q("SELECT * FROM roadmaps WHERE uid=? ORDER BY id DESC", (uid,))[0]]
    def get(self, uid, rid):
        r = self._q("SELECT * FROM roadmaps WHERE id=? AND uid=?", (self._id(rid), uid))[0]; return self._row(r[0]) if r else None
    def create(self, uid, data): return self._q("INSERT INTO roadmaps(uid,data,created_at) VALUES(?,?,?)", (uid, json.dumps(data), _now()))[1]
    def update(self, uid, rid, patch):
        cur = self.get(uid, rid)
        if not cur: return False
        cur.update(patch); cur.pop("id"); cur.pop("created_at")
        return self._q("UPDATE roadmaps SET data=? WHERE id=? AND uid=?", (json.dumps(cur), self._id(rid), uid))[2] > 0
    def delete(self, uid, rid): return self._q("DELETE FROM roadmaps WHERE id=? AND uid=?", (self._id(rid), uid))[2] > 0


def _now(): return datetime.now(timezone.utc).isoformat()

_hits = defaultdict(deque)
def rate_limited(key, limit=5, window=60):
    now, q = time.time(), _hits[key]
    while q and now - q[0] > window: q.popleft()
    if len(q) >= limit: return True
    q.append(now); return False

def err(msg, status, **extra): return jsonify({"ok": False, "error": msg, **extra}), status
def _pct(r):
    n = sum(len(m["topics"]) for m in r["modules"]); return round(len(r.get("completed", [])) / n * 100) if n else 0


def create_app(db_path=None):
    app = Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=64 * 1024, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE") == "1", PERMANENT_SESSION_LIFETIME=timedelta(days=14))
    key = os.getenv("SECRET_KEY")
    if not key: log.warning("SECRET_KEY not set: using a temporary one, logins reset on restart."); key = secrets.token_hex(32)
    app.secret_key = key
    app.config["STORE"] = SQLiteStore(db_path or os.getenv("DATABASE_PATH", "skillup.db"))
    store = lambda: app.config["STORE"]
    ip = lambda: request.remote_addr or "anon"

    def login_required(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            uid = session.get("uid")
            if not uid or not store().user_by_id(uid): return err("Sign in required.", 401)
            g.uid = uid; return fn(*a, **kw)
        return wrapper

    @app.get("/")
    def index():
        user = store().user_by_id(session.get("uid")) if session.get("uid") else None
        return render_template("index.html") if user else render_template("signin.html")

    @app.get("/api/health")
    def health(): return jsonify({"ok": True, "gemini_configured": bool(os.getenv("GEMINI_API_KEY")), "auth": "local-sqlite"})

    # ---- accounts
    def _creds():
        b = request.get_json(silent=True)
        b = b if isinstance(b, dict) else {}
        return str(b.get("name") or "").strip(), str(b.get("email", "")).strip().lower(), str(b.get("password", ""))

    @app.post("/api/auth/register")
    def register():
        if rate_limited("auth:" + ip(), 10): return err("Too many attempts. Wait a minute.", 429)
        name, email, pw = _creds()
        if not 1 <= len(name) <= 100: return err("Enter your full name (up to 100 characters).", 400)
        if not EMAIL_RE.match(email) or len(email) > 254: return err("Enter a valid email address.", 400)
        if not 8 <= len(pw) <= 128: return err("Password must be 8-128 characters.", 400)
        uid = store().add_user(email, name, generate_password_hash(pw))
        if uid is None: return err("An account with that email already exists.", 409)
        session.clear(); session["uid"] = uid; session.permanent = True
        return jsonify({"ok": True, "user": {"email": email, "name": name}}), 201

    @app.post("/api/auth/login")
    def login():
        if rate_limited("auth:" + ip(), 10): return err("Too many attempts. Wait a minute.", 429)
        name, email, pw = _creds(); u = store().user_by_email(email)
        if not u or not check_password_hash(u["pw_hash"], pw): return err("Incorrect email or password.", 401)
        if name and len(name) > 100: return err("Name must be 100 characters or fewer.", 400)
        if name:
            store().set_name(u["id"], name)
            u["name"] = name
        elif not u.get("name"):
            return err("Enter your full name to personalize your certificates.", 400)
        session.clear(); session["uid"] = u["id"]; session.permanent = True
        return jsonify({"ok": True, "user": {"email": u["email"], "name": u["name"]}})

    @app.post("/api/auth/logout")
    def logout(): session.clear(); return jsonify({"ok": True})

    @app.get("/api/auth/me")
    def me():
        u = store().user_by_id(session["uid"]) if session.get("uid") else None
        return jsonify({"ok": True, "user": {"email": u["email"], "name": u["name"]} if u else None})

    # ---- roadmap generation (login optional unless REQUIRE_AUTH_FOR_AI=true)
    @app.post("/api/roadmap")
    def generate():
        try: clean = rs.validate_input(request.get_json(silent=True))
        except rs.ValidationError as e: return err("Check the highlighted fields.", 400, fields=e.errors)
        if os.getenv("REQUIRE_AUTH_FOR_AI") == "true" and not session.get("uid"): return err("Sign in to generate roadmaps.", 401)
        if rate_limited(str(session.get("uid") or ip())): return err("Too many requests. Wait a minute and try again.", 429)
        try: return jsonify({"ok": True, **rs.generate(clean)})
        except rs.NotConfigured as e: return err(str(e), 501, code="gemini_not_configured")
        except rs.AIError as e: return err(e.message, e.status)

    # ---- saved roadmaps
    @app.post("/api/roadmaps")
    @login_required
    def save():
        body = request.get_json(silent=True)
        rm_in = body.get("roadmap") if isinstance(body, dict) else None
        if not isinstance(rm_in, dict): return err("Send {\"roadmap\": {...}}.", 400)
        try: rm = rs.validate_roadmap(rm_in, source="gemini" if rm_in.get("source") == "gemini" else "demo")
        except rs.AIError: return err("That roadmap is not in a valid format.", 400)
        rm["completed"] = []
        if isinstance(rm_in.get("timers"), dict): rm["timers"] = rm_in["timers"]
        if isinstance(rm_in.get("inputs"), dict): rm["inputs"] = rm_in["inputs"]
        try: return jsonify({"ok": True, "id": str(store().create(g.uid, rm))}), 201
        except Exception: log.exception("save failed"); return err("Could not save the roadmap.", 500)

    @app.get("/api/roadmaps")
    @login_required
    def list_all(): return jsonify({"ok": True, "roadmaps": store().list(g.uid)})

    @app.get("/api/roadmaps/<rid>")
    @login_required
    def get_one(rid):
        r = store().get(g.uid, rid)
        if not r: return err("Roadmap not found.", 404)
        return jsonify({"ok": True, "roadmap": r, "progress": _pct(r), "next_step": recommend.next_step(r, r.get("completed", []))})

    @app.patch("/api/roadmaps/<rid>/progress")
    @login_required
    def progress(rid):
        r = store().get(g.uid, rid)
        if not r: return err("Roadmap not found.", 404)
        b = request.get_json(silent=True); keys = b.get("completed") if isinstance(b, dict) else None
        valid = {f"{i}:{t}" for i, m in enumerate(r["modules"]) for t in range(len(m["topics"]))}
        if not isinstance(keys, list) or not all(isinstance(k, str) and k in valid for k in keys):
            return err("completed must be a list of valid topic keys like '0:1'.", 400)
        keys = sorted(set(keys))
        patch = {"completed": keys}
        if isinstance(b, dict) and isinstance(b.get("timers"), dict): patch["timers"] = b["timers"]
        if not store().update(g.uid, rid, patch): return err("Roadmap not found.", 404)
        r["completed"] = keys
        if "timers" in patch: r["timers"] = patch["timers"]
        return jsonify({"ok": True, "progress": _pct(r), "next_step": recommend.next_step(r, keys)})

    @app.delete("/api/roadmaps/<rid>")
    @login_required
    def remove(rid): return jsonify({"ok": True}) if store().delete(g.uid, rid) else err("Roadmap not found.", 404)

    @app.errorhandler(404)
    def nf(e):
        if request.path.startswith("/api/"): return err("Not found.", 404)
        user = store().user_by_id(session.get("uid")) if session.get("uid") else None
        return (render_template("index.html") if user else render_template("signin.html"), 200)
    @app.errorhandler(413)
    def big(e): return err("Request too large.", 413)
    @app.errorhandler(500)
    def boom(e): return err("Something went wrong on the server.", 500)
    return app


app = create_app()
if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG") == "1")
