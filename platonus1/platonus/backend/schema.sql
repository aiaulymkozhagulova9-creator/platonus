PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,                 -- ашық құпиясөз ешқашан сақталмайды
    full_name     TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('student','teacher','admin')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    approved      INTEGER NOT NULL DEFAULT 1,       -- 0: оқытушы тіркелді, әкімші растауын күтуде
    email         TEXT    NOT NULL DEFAULT '',
    phone         TEXT    NOT NULL DEFAULT '',
    department    TEXT    NOT NULL DEFAULT '',      -- кафедра (оқытушы)
    position      TEXT    NOT NULL DEFAULT '',      -- лауазым / ғылыми дәреже
    bio           TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS groups (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL UNIQUE,
    specialty TEXT    NOT NULL,
    course    INTEGER NOT NULL CHECK (course BETWEEN 1 AND 6)
);

-- Студент профилі: users (1) — (1) students, топқа байланған
CREATE TABLE IF NOT EXISTS students (
    user_id  INTEGER PRIMARY KEY REFERENCES users(id)  ON DELETE CASCADE,
    group_id INTEGER NOT NULL    REFERENCES groups(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS subjects (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    code    TEXT    NOT NULL UNIQUE,
    name    TEXT    NOT NULL,
    credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 20)
);

-- Оқу жүктемесі: қай оқытушы қай топқа қай пәнді жүргізеді
CREATE TABLE IF NOT EXISTS offerings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    teacher_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
    group_id   INTEGER NOT NULL REFERENCES groups(id)   ON DELETE RESTRICT,
    semester   TEXT    NOT NULL DEFAULT '2026-күз',
    UNIQUE (subject_id, teacher_id, group_id, semester)
);

CREATE TABLE IF NOT EXISTS schedule (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
    weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    start_time  TEXT    NOT NULL,
    end_time    TEXT    NOT NULL,
    room        TEXT    NOT NULL,
    lesson_type TEXT    NOT NULL DEFAULT 'Дәріс',
    CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS assignments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    deadline    TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS submissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id    INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    file_name     TEXT    NOT NULL,
    stored_name   TEXT    NOT NULL,
    file_size     INTEGER NOT NULL,
    comment       TEXT    NOT NULL DEFAULT '',
    submitted_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (assignment_id, student_id)
);

-- Ағымдағы журнал: 1-аралық (rk1), 2-аралық (rk2), қорытынды емтихан (final)
CREATE TABLE IF NOT EXISTS grades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    offering_id INTEGER NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
    student_id  INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('rk1','rk2','final')),
    score       REAL    NOT NULL CHECK (score BETWEEN 0 AND 100),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (offering_id, student_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_schedule_offering ON schedule(offering_id);
CREATE INDEX IF NOT EXISTS idx_offerings_group   ON offerings(group_id);
CREATE INDEX IF NOT EXISTS idx_offerings_teacher ON offerings(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assign_offering   ON assignments(offering_id);
CREATE INDEX IF NOT EXISTS idx_grades_student    ON grades(student_id);
