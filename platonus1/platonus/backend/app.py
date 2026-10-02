"""Platonus — оқу порталы. Flask REST API + SQLite.

Іске қосу:  python app.py   →  http://localhost:5000
"""
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request, send_file, send_from_directory
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("PLATONUS_DB", BASE / "platonus.db"))
UPLOAD_DIR = Path(os.environ.get("PLATONUS_UPLOADS", BASE / "uploads"))
FRONTEND_DIR = BASE.parent / "frontend"

TOKEN_TTL = 12 * 3600                    # токен 12 сағат жарамды
MAX_UPLOAD = 15 * 1024 * 1024            # 15 МБ
ALLOWED_EXT = {"pdf": b"%PDF", "zip": b"PK\x03\x04", "docx": b"PK\x03\x04"}
WEIGHTS = {"rk1": 0.3, "rk2": 0.3, "final": 0.4}
LESSON_TYPES = ("Дәріс", "Практика", "Зертхана")


def _secret_key() -> str:
    env = os.environ.get("PLATONUS_SECRET")
    if env:
        return env
    f = BASE / ".secret_key"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
    return f.read_text().strip()


app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD
serializer = URLSafeTimedSerializer(_secret_key(), salt="platonus-auth")
DUMMY_HASH = generate_password_hash("dummy-password")


# ───────────────────────── Дерекқор ─────────────────────────
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query(sql, args=(), one=False):
    cur = get_db().execute(sql, args)
    rows = [dict(r) for r in cur.fetchall()]
    return (rows[0] if rows else None) if one else rows


def execute(sql, args=()):
    cur = get_db().execute(sql, args)
    return cur.lastrowid


def init_db():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript((BASE / "schema.sql").read_text(encoding="utf-8"))
    # ескі дерекқорларды жаңарту (жаңа баған қосу)
    have = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    for name, ddl in {
        "approved": "INTEGER NOT NULL DEFAULT 1", "email": "TEXT NOT NULL DEFAULT ''",
        "phone": "TEXT NOT NULL DEFAULT ''", "department": "TEXT NOT NULL DEFAULT ''",
        "position": "TEXT NOT NULL DEFAULT ''", "bio": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if name not in have:
            con.execute(f"ALTER TABLE users ADD COLUMN {name} {ddl}")
    con.commit()
    con.close()


# ───────────────────────── Көмекші функциялар ─────────────────────────
class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify(error=e.message), e.status


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error="Файл тым үлкен (ең көбі 15 МБ)"), 413


@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/"):
        return jsonify(error="Табылмады"), 404
    return "Табылмады", 404


@app.errorhandler(405)
def bad_method(_e):
    return jsonify(error="Әдіс рұқсат етілмеген"), 405


def payload() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("JSON денесі қажет")
    return data


def text(data, key, label, max_len=200, required=True):
    val = data.get(key)
    val = val.strip() if isinstance(val, str) else ("" if val is None else str(val).strip())
    if required and not val:
        raise ApiError(f"«{label}» өрісін толтырыңыз")
    if len(val) > max_len:
        raise ApiError(f"«{label}» тым ұзын (ең көбі {max_len} таңба)")
    return val


def integer(data, key, label, lo=None, hi=None, required=True):
    val = data.get(key)
    if val in (None, ""):
        if required:
            raise ApiError(f"«{label}» өрісін толтырыңыз")
        return None
    try:
        val = int(val)
    except (TypeError, ValueError):
        raise ApiError(f"«{label}» бүтін сан болуы керек")
    if (lo is not None and val < lo) or (hi is not None and val > hi):
        raise ApiError(f"«{label}» мәні {lo}–{hi} аралығында болуы керек")
    return val


TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def time_str(data, key, label):
    val = text(data, key, label, 5)
    if not TIME_RE.match(val):
        raise ApiError(f"«{label}» уақыты ЖЖ:ММ форматында болуы керек")
    return val


def letter(score):
    table = [(95, "A"), (90, "A-"), (85, "B+"), (80, "B"), (75, "B-"),
             (70, "C+"), (65, "C"), (60, "C-"), (55, "D+"), (50, "D")]
    for limit, mark in table:
        if score >= limit:
            return mark
    return "F"


def integrity_message(e: sqlite3.IntegrityError) -> str:
    msg = str(e)
    if "UNIQUE" in msg:
        return "Мұндай жазба бұрыннан бар"
    if "FOREIGN KEY" in msg:
        return "Байланысты деректер бар: алдымен оларды жойыңыз немесе өзгертіңіз"
    if "CHECK" in msg:
        return "Мән рұқсат етілген шектен тыс"
    return "Дерекқор шектеуі бұзылды"


# ───────────────────────── Авторизация ─────────────────────────
_failed = {}   # (ip, username) -> (саны, бұғат аяқталатын уақыт)


def _locked(key):
    cnt, until = _failed.get(key, (0, 0))
    return cnt >= 5 and time.time() < until


def make_token(uid):
    return serializer.dumps({"uid": uid})


def current_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        data = serializer.loads(header[7:], max_age=TOKEN_TTL)
    except (BadSignature, SignatureExpired):
        return None
    user = query("SELECT id, username, full_name, role, is_active, approved FROM users WHERE id=?",
                 (data["uid"],), one=True)
    if not user or not user["is_active"] or not user["approved"]:
        return None
    return user


def auth(*roles):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            user = current_user()
            if not user:
                raise ApiError("Жүйеге кіріңіз", 401)
            if roles and user["role"] not in roles:
                raise ApiError("Бұл әрекетке рұқсатыңыз жоқ", 403)
            g.user = user
            return fn(*a, **kw)
        return wrapper
    return deco


@app.post("/api/auth/login")
def login():
    data = payload()
    username = text(data, "username", "Логин", 64)
    password = data.get("password") or ""
    key = (request.remote_addr, username.lower())
    if _locked(key):
        raise ApiError("Тым көп қате әрекет. Бір минуттан кейін қайталаңыз", 429)

    user = query("SELECT * FROM users WHERE username=?", (username,), one=True)
    ok = check_password_hash(user["password_hash"] if user else DUMMY_HASH, password)
    if not (user and ok):
        cnt = _failed.get(key, (0, 0))[0] + 1
        _failed[key] = (cnt, time.time() + 60)
        raise ApiError("Логин немесе құпиясөз қате", 401)
    # құпиясөз дұрыс болғаннан кейін ғана аккаунт күйін хабарлаймыз
    if not user["approved"]:
        raise ApiError("Аккаунтыңыз әкімші растауын күтуде. Растағаннан кейін кіре аласыз", 403)
    if not user["is_active"]:
        raise ApiError("Аккаунт бұғатталған. Әкімшіге хабарласыңыз", 403)

    _failed.pop(key, None)
    return jsonify(token=make_token(user["id"]), user=public_user(user["id"]))


def public_user(uid):
    u = query("""SELECT u.id, u.username, u.full_name, u.role, s.group_id, gr.name AS group_name
                 FROM users u
                 LEFT JOIN students s ON s.user_id = u.id
                 LEFT JOIN groups gr  ON gr.id = s.group_id
                 WHERE u.id=?""", (uid,), one=True)
    return u


@app.get("/api/auth/me")
@auth()
def me():
    return jsonify(user=public_user(g.user["id"]))


@app.post("/api/auth/password")
@auth()
def change_password():
    data = payload()
    old, new = data.get("old_password") or "", data.get("new_password") or ""
    row = query("SELECT password_hash FROM users WHERE id=?", (g.user["id"],), one=True)
    if not check_password_hash(row["password_hash"], old):
        raise ApiError("Ағымдағы құпиясөз қате", 400)
    if len(new) < 6:
        raise ApiError("Жаңа құпиясөз кемінде 6 таңба болуы керек")
    execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new), g.user["id"]))
    get_db().commit()
    return jsonify(ok=True)


# ───────────────────────── Тіркелу ─────────────────────────
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[0-9+()\-\s]{0,30}$")
_reg_log = {}   # ip -> тіркелу уақыттары (спамнан қорғау)


def clean_email(data):
    email = text(data, "email", "Email", 120, required=False)
    if email and not EMAIL_RE.match(email):
        raise ApiError("Email форматы қате")
    return email


@app.get("/api/public/groups")
def public_groups():
    """Тіркелу формасында топ таңдау үшін (авторизациясыз)."""
    return jsonify(items=query("SELECT id, name, specialty FROM groups ORDER BY name"))


@app.post("/api/auth/register")
def register():
    ip = request.remote_addr
    now = time.time()
    recent = [t for t in _reg_log.get(ip, []) if now - t < 3600]
    if len(recent) >= 10:
        raise ApiError("Тым көп тіркелу әрекеті. Кейінірек қайталаңыз", 429)

    data = payload()
    role = text(data, "role", "Рөл", 10)
    if role not in ("student", "teacher"):
        raise ApiError("Өздігінен тек студент немесе оқытушы ретінде тіркелуге болады")
    full_name = text(data, "full_name", "Аты-жөні", 120)
    username = text(data, "username", "Логин", 32)
    if not USERNAME_RE.match(username):
        raise ApiError("Логин 3–32 таңба: латын әріптері, сандар, _ . -")
    password = data.get("password") or ""
    if len(password) < 6:
        raise ApiError("Құпиясөз кемінде 6 таңба болуы керек")
    email = clean_email(data)

    group_id, department = None, ""
    if role == "student":
        group_id = integer(data, "group_id", "Топ")
        if not query("SELECT 1 FROM groups WHERE id=?", (group_id,), one=True):
            raise ApiError("Топ табылмады")
    else:
        department = text(data, "department", "Кафедра", 120, required=False)

    approved = 1 if role == "student" else 0   # оқытушыны әкімші растайды
    db = get_db()
    try:
        uid = execute("""INSERT INTO users(username,password_hash,full_name,role,approved,email,department)
                         VALUES (?,?,?,?,?,?,?)""",
                      (username, generate_password_hash(password), full_name, role, approved, email, department))
        if role == "student":
            execute("INSERT INTO students(user_id, group_id) VALUES (?,?)", (uid, group_id))
        db.commit()
    except sqlite3.IntegrityError as e:
        db.rollback()
        if "UNIQUE" in str(e):
            raise ApiError("Бұл логин бос емес, басқасын таңдаңыз", 409)
        raise ApiError(integrity_message(e), 409)

    _reg_log[ip] = recent + [now]
    if approved:
        return jsonify(token=make_token(uid), user=public_user(uid)), 201
    return jsonify(pending=True), 201


# ───────────────────────── Жеке профиль ─────────────────────────
@app.get("/api/profile")
@auth()
def get_profile():
    u = g.user
    info = query("""SELECT u.id, u.username, u.full_name, u.role, u.email, u.phone, u.department,
                           u.position, u.bio, u.created_at, gr.name AS group_name,
                           gr.specialty, gr.course
                    FROM users u
                    LEFT JOIN students s ON s.user_id=u.id
                    LEFT JOIN groups gr ON gr.id=s.group_id
                    WHERE u.id=?""", (u["id"],), one=True)
    out = {"profile": info}

    if u["role"] == "teacher":
        offs = query("""SELECT o.id, sub.name AS subject, gr.name AS group_name,
                               (SELECT COUNT(*) FROM students st WHERE st.group_id=o.group_id) AS students
                        FROM offerings o JOIN subjects sub ON sub.id=o.subject_id
                        JOIN groups gr ON gr.id=o.group_id
                        WHERE o.teacher_id=? ORDER BY sub.name""", (u["id"],))
        today = query(SCHEDULE_SQL + " WHERE o.teacher_id=? AND sc.weekday=? ORDER BY sc.start_time",
                      (u["id"], datetime.now().isoweekday()))
        out["teacher"] = {
            "offerings": offs,
            "today": today,
            "groups": len({o["group_name"] for o in offs}),
            "students": sum(o["students"] for o in offs),
            "assignments": query("""SELECT COUNT(*) n FROM assignments a JOIN offerings o ON o.id=a.offering_id
                                    WHERE o.teacher_id=?""", (u["id"],), one=True)["n"],
            "submissions": query("""SELECT COUNT(*) n FROM submissions s
                                    JOIN assignments a ON a.id=s.assignment_id
                                    JOIN offerings o ON o.id=a.offering_id
                                    WHERE o.teacher_id=?""", (u["id"],), one=True)["n"],
        }
    elif u["role"] == "admin":
        out["admin"] = {
            "stats": system_stats(),
            "pending": query("""SELECT id, username, full_name, email, department, created_at
                                FROM users WHERE approved=0 ORDER BY created_at"""),
        }
    else:
        out["student"] = {"subjects": query("""SELECT COUNT(*) n FROM offerings
                          WHERE group_id=(SELECT group_id FROM students WHERE user_id=?)""",
                                            (u["id"],), one=True)["n"]}
    return jsonify(out)


@app.put("/api/profile")
@auth()
def update_profile():
    data = payload()
    sets, vals = [], []
    if "full_name" in data:
        sets.append("full_name=?"); vals.append(text(data, "full_name", "Аты-жөні", 120))
    if "email" in data:
        sets.append("email=?"); vals.append(clean_email(data))
    if "phone" in data:
        phone = text(data, "phone", "Телефон", 30, required=False)
        if not PHONE_RE.match(phone):
            raise ApiError("Телефон нөмірінде тек сан, +, (, ), - болуы мүмкін")
        sets.append("phone=?"); vals.append(phone)
    if g.user["role"] in ("teacher", "admin"):
        for key, label, mx in (("department", "Кафедра", 120), ("position", "Лауазым", 120), ("bio", "Өзім туралы", 1000)):
            if key in data:
                sets.append(f"{key}=?"); vals.append(text(data, key, label, mx, required=False))
    if not sets:
        raise ApiError("Өзгертетін дерек жоқ")
    execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", (*vals, g.user["id"]))
    get_db().commit()
    return jsonify(ok=True, user=public_user(g.user["id"]))


# ───────────────────────── Сабақ кестесі ─────────────────────────
SCHEDULE_SQL = """
SELECT sc.id, sc.weekday, sc.start_time, sc.end_time, sc.room, sc.lesson_type,
       o.id AS offering_id, sub.name AS subject, sub.id AS subject_id,
       t.full_name AS teacher, gr.name AS group_name, gr.id AS group_id
FROM schedule sc
JOIN offerings o ON o.id = sc.offering_id
JOIN subjects  sub ON sub.id = o.subject_id
JOIN users     t   ON t.id = o.teacher_id
JOIN groups    gr  ON gr.id = o.group_id
"""


@app.get("/api/schedule")
@auth()
def schedule():
    u = g.user
    if u["role"] == "student":
        rows = query(SCHEDULE_SQL + " WHERE o.group_id = (SELECT group_id FROM students WHERE user_id=?) "
                     "ORDER BY sc.weekday, sc.start_time", (u["id"],))
    elif u["role"] == "teacher":
        rows = query(SCHEDULE_SQL + " WHERE o.teacher_id=? ORDER BY sc.weekday, sc.start_time", (u["id"],))
    else:
        gid = request.args.get("group_id", type=int)
        if gid:
            rows = query(SCHEDULE_SQL + " WHERE o.group_id=? ORDER BY sc.weekday, sc.start_time", (gid,))
        else:
            rows = query(SCHEDULE_SQL + " ORDER BY sc.weekday, sc.start_time")
    return jsonify(items=rows)


# ───────────────────────── Тапсырмалар ─────────────────────────
def teacher_offering(offering_id):
    row = query("SELECT * FROM offerings WHERE id=?", (offering_id,), one=True)
    if not row:
        raise ApiError("Пән жүктемесі табылмады", 404)
    if g.user["role"] == "teacher" and row["teacher_id"] != g.user["id"]:
        raise ApiError("Бұл сіздің пәніңіз емес", 403)
    return row


@app.get("/api/offerings")
@auth("teacher", "admin")
def my_offerings():
    sql = """SELECT o.id, o.semester, sub.name AS subject, gr.name AS group_name, t.full_name AS teacher
             FROM offerings o
             JOIN subjects sub ON sub.id=o.subject_id
             JOIN groups gr ON gr.id=o.group_id
             JOIN users t ON t.id=o.teacher_id"""
    if g.user["role"] == "teacher":
        rows = query(sql + " WHERE o.teacher_id=? ORDER BY sub.name, gr.name", (g.user["id"],))
    else:
        rows = query(sql + " ORDER BY sub.name, gr.name")
    return jsonify(items=rows)


@app.get("/api/assignments")
@auth("student", "teacher")
def list_assignments():
    u = g.user
    if u["role"] == "student":
        rows = query("""
            SELECT a.id, a.title, a.description, a.deadline, sub.name AS subject, t.full_name AS teacher,
                   s.id AS submission_id, s.file_name, s.submitted_at, s.comment
            FROM assignments a
            JOIN offerings o ON o.id = a.offering_id
            JOIN subjects sub ON sub.id = o.subject_id
            JOIN users t ON t.id = o.teacher_id
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
            WHERE o.group_id = (SELECT group_id FROM students WHERE user_id = ?)
            ORDER BY a.deadline DESC""", (u["id"], u["id"]))
        for r in rows:
            r["submitted"] = r["submission_id"] is not None
            r["late"] = bool(r["submitted"] and r["submitted_at"][:16].replace(" ", "T") > r["deadline"])
    else:
        rows = query("""
            SELECT a.id, a.title, a.description, a.deadline, a.offering_id,
                   sub.name AS subject, gr.name AS group_name,
                   (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submitted_count,
                   (SELECT COUNT(*) FROM students st WHERE st.group_id = o.group_id) AS student_count
            FROM assignments a
            JOIN offerings o ON o.id = a.offering_id
            JOIN subjects sub ON sub.id = o.subject_id
            JOIN groups gr ON gr.id = o.group_id
            WHERE o.teacher_id = ?
            ORDER BY a.deadline DESC""", (u["id"],))
    return jsonify(items=rows)


@app.post("/api/assignments")
@auth("teacher")
def create_assignment():
    data = payload()
    offering_id = integer(data, "offering_id", "Пән")
    teacher_offering(offering_id)
    title = text(data, "title", "Атауы", 150)
    desc = text(data, "description", "Сипаттама", 2000, required=False)
    deadline = text(data, "deadline", "Мерзімі", 16)
    try:
        datetime.strptime(deadline, "%Y-%m-%dT%H:%M")
    except ValueError:
        raise ApiError("Мерзім форматы қате")
    aid = execute("INSERT INTO assignments(offering_id,title,description,deadline) VALUES (?,?,?,?)",
                  (offering_id, title, desc, deadline))
    get_db().commit()
    return jsonify(id=aid), 201


@app.delete("/api/assignments/<int:aid>")
@auth("teacher")
def delete_assignment(aid):
    a = query("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
    if not a:
        raise ApiError("Тапсырма табылмады", 404)
    teacher_offering(a["offering_id"])
    files = query("SELECT stored_name FROM submissions WHERE assignment_id=?", (aid,))
    execute("DELETE FROM assignments WHERE id=?", (aid,))
    get_db().commit()
    for f in files:
        (UPLOAD_DIR / f["stored_name"]).unlink(missing_ok=True)
    return jsonify(ok=True)


@app.get("/api/assignments/<int:aid>/submissions")
@auth("teacher")
def assignment_submissions(aid):
    a = query("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
    if not a:
        raise ApiError("Тапсырма табылмады", 404)
    off = teacher_offering(a["offering_id"])
    rows = query("""
        SELECT u.id AS student_id, u.full_name, s.id AS submission_id, s.file_name, s.file_size,
               s.submitted_at, s.comment
        FROM students st
        JOIN users u ON u.id = st.user_id
        LEFT JOIN submissions s ON s.student_id = u.id AND s.assignment_id = ?
        WHERE st.group_id = ?
        ORDER BY u.full_name""", (aid, off["group_id"]))
    for r in rows:
        r["late"] = bool(r["submission_id"] and r["submitted_at"][:16].replace(" ", "T") > a["deadline"])
    return jsonify(assignment=a, items=rows)


def sniff_ok(stream, ext) -> bool:
    head = stream.read(4)
    stream.seek(0)
    return head.startswith(ALLOWED_EXT[ext])


@app.post("/api/assignments/<int:aid>/submit")
@auth("student")
def submit(aid):
    a = query("""SELECT a.*, o.group_id FROM assignments a JOIN offerings o ON o.id=a.offering_id
                 WHERE a.id=?""", (aid,), one=True)
    st = query("SELECT group_id FROM students WHERE user_id=?", (g.user["id"],), one=True)
    if not a or not st or a["group_id"] != st["group_id"]:
        raise ApiError("Тапсырма табылмады", 404)

    f = request.files.get("file")
    if not f or not f.filename:
        raise ApiError("Файл таңдаңыз")
    display = Path(f.filename).name[:150]
    ext = Path(display).suffix.lower().lstrip(".")
    if ext not in ALLOWED_EXT:
        raise ApiError("Тек PDF, ZIP немесе DOCX файлдарына рұқсат етіледі")
    if not sniff_ok(f.stream, ext):
        raise ApiError("Файл мазмұны кеңейтілуіне сәйкес келмейді")

    stored = f"{uuid.uuid4().hex}.{ext}"
    f.save(UPLOAD_DIR / stored)
    size = (UPLOAD_DIR / stored).stat().st_size
    comment = (request.form.get("comment") or "").strip()[:500]

    old = query("SELECT stored_name FROM submissions WHERE assignment_id=? AND student_id=?",
                (aid, g.user["id"]), one=True)
    db = get_db()
    db.execute("""INSERT INTO submissions(assignment_id, student_id, file_name, stored_name, file_size, comment)
                  VALUES (?,?,?,?,?,?)
                  ON CONFLICT(assignment_id, student_id) DO UPDATE SET
                    file_name=excluded.file_name, stored_name=excluded.stored_name,
                    file_size=excluded.file_size, comment=excluded.comment,
                    submitted_at=datetime('now','localtime')""",
               (aid, g.user["id"], display, stored, size, comment))
    db.commit()
    if old:
        (UPLOAD_DIR / old["stored_name"]).unlink(missing_ok=True)
    return jsonify(ok=True, file_name=display), 201


@app.get("/api/submissions/<int:sid>/file")
@auth("student", "teacher", "admin")
def download_submission(sid):
    s = query("""SELECT s.*, o.teacher_id FROM submissions s
                 JOIN assignments a ON a.id=s.assignment_id
                 JOIN offerings o ON o.id=a.offering_id WHERE s.id=?""", (sid,), one=True)
    if not s:
        raise ApiError("Файл табылмады", 404)
    u = g.user
    allowed = (u["role"] == "admin" or (u["role"] == "teacher" and s["teacher_id"] == u["id"])
               or (u["role"] == "student" and s["student_id"] == u["id"]))
    if not allowed:
        raise ApiError("Рұқсат жоқ", 403)
    path = UPLOAD_DIR / s["stored_name"]
    if not path.exists():
        raise ApiError("Файл серверде жоқ", 404)
    return send_file(path, as_attachment=True, download_name=s["file_name"])


# ───────────────────────── Журнал ─────────────────────────
def total_of(marks):
    if all(k in marks and marks[k] is not None for k in WEIGHTS):
        return round(sum(marks[k] * w for k, w in WEIGHTS.items()), 1)
    return None


@app.get("/api/journal")
@auth("student")
def journal():
    offs = query("""SELECT o.id, sub.name AS subject, sub.credits, t.full_name AS teacher
                    FROM offerings o
                    JOIN subjects sub ON sub.id=o.subject_id
                    JOIN users t ON t.id=o.teacher_id
                    WHERE o.group_id=(SELECT group_id FROM students WHERE user_id=?)
                    ORDER BY sub.name""", (g.user["id"],))
    grades = query("SELECT offering_id, kind, score FROM grades WHERE student_id=?", (g.user["id"],))
    by_off = {}
    for gr in grades:
        by_off.setdefault(gr["offering_id"], {})[gr["kind"]] = gr["score"]
    for o in offs:
        marks = by_off.get(o["id"], {})
        o.update(rk1=marks.get("rk1"), rk2=marks.get("rk2"), final=marks.get("final"))
        o["total"] = total_of(marks)
        o["letter"] = letter(o["total"]) if o["total"] is not None else None
    return jsonify(items=offs, weights=WEIGHTS)


@app.get("/api/offerings/<int:oid>/grades")
@auth("teacher", "admin")
def offering_grades(oid):
    off = teacher_offering(oid)
    studs = query("""SELECT u.id AS student_id, u.full_name FROM students st
                     JOIN users u ON u.id=st.user_id WHERE st.group_id=? ORDER BY u.full_name""",
                  (off["group_id"],))
    grades = query("SELECT student_id, kind, score FROM grades WHERE offering_id=?", (oid,))
    idx = {}
    for gr in grades:
        idx.setdefault(gr["student_id"], {})[gr["kind"]] = gr["score"]
    for s in studs:
        marks = idx.get(s["student_id"], {})
        s.update(rk1=marks.get("rk1"), rk2=marks.get("rk2"), final=marks.get("final"))
        s["total"] = total_of(marks)
        s["letter"] = letter(s["total"]) if s["total"] is not None else None
    return jsonify(items=studs, weights=WEIGHTS)


@app.put("/api/offerings/<int:oid>/grades")
@auth("teacher")
def save_grades(oid):
    off = teacher_offering(oid)
    data = payload()
    rows = data.get("grades")
    if not isinstance(rows, list):
        raise ApiError("Бағалар тізімі қажет")
    valid_students = {r["user_id"] for r in query("SELECT user_id FROM students WHERE group_id=?",
                                                  (off["group_id"],))}
    db = get_db()
    for row in rows:
        sid = row.get("student_id")
        if sid not in valid_students:
            raise ApiError("Студент бұл топта жоқ")
        for kind in WEIGHTS:
            if kind not in row:
                continue
            val = row[kind]
            if val in (None, ""):
                db.execute("DELETE FROM grades WHERE offering_id=? AND student_id=? AND kind=?",
                           (oid, sid, kind))
                continue
            try:
                val = float(val)
            except (TypeError, ValueError):
                raise ApiError("Баға сан болуы керек")
            if not 0 <= val <= 100:
                raise ApiError("Баға 0–100 аралығында болуы керек")
            db.execute("""INSERT INTO grades(offering_id, student_id, kind, score) VALUES (?,?,?,?)
                          ON CONFLICT(offering_id, student_id, kind) DO UPDATE SET
                          score=excluded.score, updated_at=datetime('now','localtime')""",
                       (oid, sid, kind, val))
    db.commit()
    return jsonify(ok=True)


# ───────────────────────── Админ панелі ─────────────────────────


def system_stats():
    def n(sql):
        return query(sql, one=True)["n"]
    return dict(
        students=n("SELECT COUNT(*) n FROM users WHERE role='student' AND approved=1"),
        teachers=n("SELECT COUNT(*) n FROM users WHERE role='teacher' AND approved=1"),
        pending=n("SELECT COUNT(*) n FROM users WHERE approved=0"),
        groups=n("SELECT COUNT(*) n FROM groups"),
        subjects=n("SELECT COUNT(*) n FROM subjects"),
        offerings=n("SELECT COUNT(*) n FROM offerings"),
        lessons=n("SELECT COUNT(*) n FROM schedule"),
    )


@app.get("/api/admin/stats")
@auth("admin")
def admin_stats():
    return jsonify(system_stats())


@app.post("/api/admin/users/<int:uid>/approve")
@auth("admin")
def admin_approve(uid):
    cur = get_db().execute("UPDATE users SET approved=1 WHERE id=? AND approved=0", (uid,))
    get_db().commit()
    if not cur.rowcount:
        raise ApiError("Растауды күтіп тұрған қолданушы табылмады", 404)
    return jsonify(ok=True)


@app.get("/api/admin/users")
@auth("admin")
def admin_users():
    role = request.args.get("role")
    sql = """SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.approved, u.email, u.created_at,
                    s.group_id, gr.name AS group_name
             FROM users u LEFT JOIN students s ON s.user_id=u.id LEFT JOIN groups gr ON gr.id=s.group_id"""
    if role in ("student", "teacher", "admin"):
        rows = query(sql + " WHERE u.role=? ORDER BY u.full_name", (role,))
    else:
        rows = query(sql + " ORDER BY u.role, u.full_name")
    return jsonify(items=rows)


@app.post("/api/admin/users")
@auth("admin")
def admin_create_user():
    data = payload()
    username = text(data, "username", "Логин", 32)
    if not USERNAME_RE.match(username):
        raise ApiError("Логин 3–32 таңба: латын әріптері, сандар, _ . -")
    full_name = text(data, "full_name", "Аты-жөні", 120)
    role = text(data, "role", "Рөл", 10)
    if role not in ("student", "teacher", "admin"):
        raise ApiError("Рөл қате")
    password = data.get("password") or ""
    if len(password) < 6:
        raise ApiError("Құпиясөз кемінде 6 таңба болуы керек")
    group_id = integer(data, "group_id", "Топ", required=(role == "student"))
    if role == "student" and not query("SELECT 1 FROM groups WHERE id=?", (group_id,), one=True):
        raise ApiError("Топ табылмады")
    db = get_db()
    try:
        uid = execute("INSERT INTO users(username,password_hash,full_name,role) VALUES (?,?,?,?)",
                      (username, generate_password_hash(password), full_name, role))
        if role == "student":
            execute("INSERT INTO students(user_id, group_id) VALUES (?,?)", (uid, group_id))
        db.commit()
    except sqlite3.IntegrityError as e:
        db.rollback()
        raise ApiError(integrity_message(e), 409)
    return jsonify(id=uid), 201


@app.put("/api/admin/users/<int:uid>")
@auth("admin")
def admin_update_user(uid):
    u = query("SELECT * FROM users WHERE id=?", (uid,), one=True)
    if not u:
        raise ApiError("Қолданушы табылмады", 404)
    data = payload()
    db = get_db()
    if "full_name" in data:
        execute("UPDATE users SET full_name=? WHERE id=?", (text(data, "full_name", "Аты-жөні", 120), uid))
    if "is_active" in data:
        if uid == g.user["id"] and not data["is_active"]:
            raise ApiError("Өзіңізді бұғаттай алмайсыз")
        execute("UPDATE users SET is_active=? WHERE id=?", (1 if data["is_active"] else 0, uid))
    if data.get("password"):
        if len(data["password"]) < 6:
            raise ApiError("Құпиясөз кемінде 6 таңба болуы керек")
        execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(data["password"]), uid))
    if "group_id" in data and u["role"] == "student":
        gid = integer(data, "group_id", "Топ")
        try:
            execute("UPDATE students SET group_id=? WHERE user_id=?", (gid, uid))
        except sqlite3.IntegrityError as e:
            db.rollback()
            raise ApiError(integrity_message(e), 409)
    db.commit()
    return jsonify(ok=True)


@app.delete("/api/admin/users/<int:uid>")
@auth("admin")
def admin_delete_user(uid):
    if uid == g.user["id"]:
        raise ApiError("Өзіңізді жоя алмайсыз")
    files = query("SELECT stored_name FROM submissions WHERE student_id=?", (uid,))
    db = get_db()
    try:
        cur = db.execute("DELETE FROM users WHERE id=?", (uid,))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        raise ApiError("Оқытушыға пән жүктемесі бекітілген. Алдымен жүктемені жойыңыз", 409)
    if not cur.rowcount:
        raise ApiError("Қолданушы табылмады", 404)
    for f in files:
        (UPLOAD_DIR / f["stored_name"]).unlink(missing_ok=True)
    return jsonify(ok=True)


def register_simple_crud(name, table, fields, order):
    """groups / subjects үшін бірдей CRUD маршруттары.
    fields: [(кілт, белгі, максимум ұзындық, 'text'|'int', (lo, hi))]"""

    def read(data):
        out = {}
        for key, label, mx, kind, rng in fields:
            out[key] = (text(data, key, label, mx) if kind == "text"
                        else integer(data, key, label, *rng))
        return out

    @app.get(f"/api/admin/{name}", endpoint=f"list_{name}")
    @auth("admin", "teacher", "student")
    def _list():
        return jsonify(items=query(f"SELECT * FROM {table} ORDER BY {order}"))

    @app.post(f"/api/admin/{name}", endpoint=f"create_{name}")
    @auth("admin")
    def _create():
        vals = read(payload())
        cols = ",".join(vals)
        db = get_db()
        try:
            rid = execute(f"INSERT INTO {table}({cols}) VALUES ({','.join('?' * len(vals))})",
                          tuple(vals.values()))
            db.commit()
        except sqlite3.IntegrityError as e:
            db.rollback()
            raise ApiError(integrity_message(e), 409)
        return jsonify(id=rid), 201

    @app.put(f"/api/admin/{name}/<int:rid>", endpoint=f"update_{name}")
    @auth("admin")
    def _update(rid):
        vals = read(payload())
        sets = ",".join(f"{k}=?" for k in vals)
        db = get_db()
        try:
            cur = db.execute(f"UPDATE {table} SET {sets} WHERE id=?", (*vals.values(), rid))
            db.commit()
        except sqlite3.IntegrityError as e:
            db.rollback()
            raise ApiError(integrity_message(e), 409)
        if not cur.rowcount:
            raise ApiError("Жазба табылмады", 404)
        return jsonify(ok=True)

    @app.delete(f"/api/admin/{name}/<int:rid>", endpoint=f"delete_{name}")
    @auth("admin")
    def _delete(rid):
        db = get_db()
        try:
            cur = db.execute(f"DELETE FROM {table} WHERE id=?", (rid,))
            db.commit()
        except sqlite3.IntegrityError as e:
            db.rollback()
            raise ApiError(integrity_message(e), 409)
        if not cur.rowcount:
            raise ApiError("Жазба табылмады", 404)
        return jsonify(ok=True)


register_simple_crud("groups", "groups", [
    ("name", "Топ атауы", 30, "text", None),
    ("specialty", "Мамандық", 120, "text", None),
    ("course", "Курс", 0, "int", (1, 6)),
], "name")

register_simple_crud("subjects", "subjects", [
    ("code", "Пән коды", 20, "text", None),
    ("name", "Пән атауы", 150, "text", None),
    ("credits", "Кредит", 0, "int", (1, 20)),
], "name")


@app.get("/api/admin/offerings")
@auth("admin")
def admin_offerings():
    return jsonify(items=query("""
        SELECT o.id, o.semester, o.subject_id, o.teacher_id, o.group_id,
               sub.name AS subject, t.full_name AS teacher, gr.name AS group_name
        FROM offerings o
        JOIN subjects sub ON sub.id=o.subject_id
        JOIN users t ON t.id=o.teacher_id
        JOIN groups gr ON gr.id=o.group_id
        ORDER BY gr.name, sub.name"""))


@app.post("/api/admin/offerings")
@auth("admin")
def admin_create_offering():
    data = payload()
    subject_id = integer(data, "subject_id", "Пән")
    teacher_id = integer(data, "teacher_id", "Оқытушы")
    group_id = integer(data, "group_id", "Топ")
    semester = text(data, "semester", "Семестр", 20, required=False) or "2026-күз"
    t = query("SELECT role FROM users WHERE id=?", (teacher_id,), one=True)
    if not t or t["role"] != "teacher":
        raise ApiError("Таңдалған қолданушы оқытушы емес")
    db = get_db()
    try:
        oid = execute("INSERT INTO offerings(subject_id,teacher_id,group_id,semester) VALUES (?,?,?,?)",
                      (subject_id, teacher_id, group_id, semester))
        db.commit()
    except sqlite3.IntegrityError as e:
        db.rollback()
        raise ApiError(integrity_message(e), 409)
    return jsonify(id=oid), 201


@app.delete("/api/admin/offerings/<int:oid>")
@auth("admin")
def admin_delete_offering(oid):
    files = query("""SELECT s.stored_name FROM submissions s JOIN assignments a ON a.id=s.assignment_id
                     WHERE a.offering_id=?""", (oid,))
    db = get_db()
    cur = db.execute("DELETE FROM offerings WHERE id=?", (oid,))
    db.commit()
    if not cur.rowcount:
        raise ApiError("Жүктеме табылмады", 404)
    for f in files:
        (UPLOAD_DIR / f["stored_name"]).unlink(missing_ok=True)
    return jsonify(ok=True)


def find_conflict(offering_id, weekday, start, end, room, ignore_id=None):
    """Бір уақытта бір аудитория / оқытушы / топ қайталанбауы керек."""
    off = query("SELECT teacher_id, group_id FROM offerings WHERE id=?", (offering_id,), one=True)
    rows = query("""SELECT sc.id, sc.room, o.teacher_id, o.group_id
                    FROM schedule sc JOIN offerings o ON o.id=sc.offering_id
                    WHERE sc.weekday=? AND sc.start_time < ? AND sc.end_time > ?""",
                 (weekday, end, start))
    for r in rows:
        if ignore_id and r["id"] == ignore_id:
            continue
        if r["room"].lower() == room.lower():
            return "Бұл уақытта аудитория бос емес"
        if r["teacher_id"] == off["teacher_id"]:
            return "Оқытушының бұл уақытта басқа сабағы бар"
        if r["group_id"] == off["group_id"]:
            return "Топтың бұл уақытта басқа сабағы бар"
    return None


@app.post("/api/admin/schedule")
@auth("admin")
def admin_create_lesson():
    data = payload()
    offering_id = integer(data, "offering_id", "Пән жүктемесі")
    if not query("SELECT 1 FROM offerings WHERE id=?", (offering_id,), one=True):
        raise ApiError("Жүктеме табылмады", 404)
    weekday = integer(data, "weekday", "Апта күні", 1, 7)
    start, end = time_str(data, "start_time", "Басталуы"), time_str(data, "end_time", "Аяқталуы")
    if start >= end:
        raise ApiError("Аяқталу уақыты басталудан кейін болуы керек")
    room = text(data, "room", "Аудитория", 20)
    ltype = text(data, "lesson_type", "Сабақ түрі", 20)
    if ltype not in LESSON_TYPES:
        raise ApiError("Сабақ түрі қате")
    conflict = find_conflict(offering_id, weekday, start, end, room)
    if conflict:
        raise ApiError(conflict, 409)
    sid = execute("""INSERT INTO schedule(offering_id,weekday,start_time,end_time,room,lesson_type)
                     VALUES (?,?,?,?,?,?)""", (offering_id, weekday, start, end, room, ltype))
    get_db().commit()
    return jsonify(id=sid), 201


@app.delete("/api/admin/schedule/<int:sid>")
@auth("admin")
def admin_delete_lesson(sid):
    cur = get_db().execute("DELETE FROM schedule WHERE id=?", (sid,))
    get_db().commit()
    if not cur.rowcount:
        raise ApiError("Сабақ табылмады", 404)
    return jsonify(ok=True)


# ───────────────────────── Фронтенд (статикалық) ─────────────────────────
@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    if path.startswith("api/"):
        raise ApiError("Табылмады", 404)
    return send_from_directory(FRONTEND_DIR, path)


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def bootstrap():
    fresh = not DB_PATH.exists()
    init_db()
    if fresh:
        from seed import seed
        seed(DB_PATH)
        print("✔ Дерекқор жасалды және демо-деректермен толтырылды")


bootstrap()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
