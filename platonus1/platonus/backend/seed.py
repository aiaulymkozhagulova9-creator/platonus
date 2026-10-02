"""Демо-деректер. Тек алғашқы іске қосуда автоматты түрде орындалады.

ЕСКЕРТУ: бұл — прототипке арналған демо-құпиясөздер. Өндіріске шығарар алдында өзгертіңіз.
"""
import sqlite3
from pathlib import Path

from werkzeug.security import generate_password_hash

GROUPS = [
    ("ИС-21", "Ақпараттық жүйелер", 3),
    ("БТ-22", "Бағдарламалық инженерия", 2),
]

SUBJECTS = [
    ("CS301", "Дерекқорлар", 5),
    ("CS302", "Веб-технологиялар", 5),
    ("MA201", "Дискретті математика", 4),
    ("EN101", "Кәсіби ағылшын тілі", 3),
    ("CS210", "Алгоритмдер мен деректер құрылымы", 5),
]

TEACHERS = [
    ("teacher1", "Ахметова Айгүл Серікқызы"),
    ("teacher2", "Жүсіпов Данияр Бауыржанұлы"),
    ("teacher3", "Оразбаева Мадина Нұрланқызы"),
]

STUDENTS = [
    ("student1", "Сәрсенов Арман Ерланұлы", "ИС-21"),
    ("student2", "Қайратқызы Әсем", "ИС-21"),
    ("student3", "Төлеубаев Ержан Маратұлы", "ИС-21"),
    ("student4", "Нұрғалиева Динара Асқарқызы", "БТ-22"),
    ("student5", "Бекенов Тимур Талғатұлы", "БТ-22"),
    ("student6", "Мұратова Аружан Болатқызы", "БТ-22"),
]

# (пән коды, оқытушы, топ)
OFFERINGS = [
    ("CS301", "teacher1", "ИС-21"),
    ("CS302", "teacher2", "ИС-21"),
    ("MA201", "teacher3", "ИС-21"),
    ("EN101", "teacher3", "ИС-21"),
    ("CS210", "teacher2", "БТ-22"),
    ("CS301", "teacher1", "БТ-22"),
    ("EN101", "teacher3", "БТ-22"),
]

# (пән коды, топ, күн, басы, соңы, аудитория, түрі)
LESSONS = [
    ("CS301", "ИС-21", 1, "09:00", "10:30", "301", "Дәріс"),
    ("CS302", "ИС-21", 1, "10:40", "12:10", "Lab-2", "Зертхана"),
    ("MA201", "ИС-21", 2, "09:00", "10:30", "204", "Дәріс"),
    ("EN101", "ИС-21", 2, "13:00", "14:30", "118", "Практика"),
    ("CS301", "ИС-21", 3, "10:40", "12:10", "Lab-1", "Зертхана"),
    ("CS302", "ИС-21", 4, "09:00", "10:30", "301", "Дәріс"),
    ("MA201", "ИС-21", 4, "13:00", "14:30", "204", "Практика"),
    ("CS301", "ИС-21", 5, "09:00", "10:30", "301", "Практика"),
    ("CS210", "БТ-22", 1, "09:00", "10:30", "215", "Дәріс"),
    ("CS301", "БТ-22", 1, "13:00", "14:30", "Lab-1", "Зертхана"),
    ("EN101", "БТ-22", 3, "09:00", "10:30", "118", "Практика"),
    ("CS210", "БТ-22", 3, "13:00", "14:30", "Lab-2", "Зертхана"),
    ("CS301", "БТ-22", 5, "10:40", "12:10", "301", "Дәріс"),
]

ASSIGNMENTS = [
    ("CS301", "ИС-21", "ER-диаграмма және схема жобалау",
     "Кітапхана жүйесі үшін ER-диаграмма сызып, 3НФ-ке келтірілген реляциялық схема жасаңыз. PDF түрінде тапсырыңыз.",
     "2026-10-09T23:59"),
    ("CS302", "ИС-21", "Адаптивті бет: портфолио",
     "HTML/CSS/JS-те телефонда да, компьютерде де дұрыс көрінетін портфолио беті. Жобаны ZIP-архивпен жіберіңіз.",
     "2026-10-14T23:59"),
    ("MA201", "ИС-21", "Графтар теориясы бойынша есептер",
     "№1–12 есептерді шығарыңыз. DOCX немесе PDF форматында.", "2026-09-20T23:59"),
    ("CS210", "БТ-22", "Сұрыптау алгоритмдерін салыстыру",
     "Үш сұрыптау алгоритмін іске асырып, уақыт күрделілігін өлшеңіз. Есеп PDF-та.", "2026-10-12T23:59"),
]

# (оқытушы-пән-топ) → студент нөмірі → (rk1, rk2, final)
GRADES = {
    ("CS301", "ИС-21"): {"student1": (86, 91, 88), "student2": (95, 97, 94), "student3": (72, 68, None)},
    ("CS302", "ИС-21"): {"student1": (90, 84, None), "student2": (88, 92, None), "student3": (65, 70, None)},
    ("MA201", "ИС-21"): {"student1": (78, 80, 85), "student2": (92, 89, 90), "student3": (55, 61, 58)},
    ("CS210", "БТ-22"): {"student4": (81, 77, None), "student5": (69, 74, None), "student6": (94, 90, None)},
}


def seed(db_path: Path):
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")
    cur = con.cursor()
    h = generate_password_hash

    cur.execute("INSERT INTO users(username,password_hash,full_name,role) VALUES (?,?,?,?)",
                ("admin", h("admin123"), "Жүйе әкімшісі", "admin"))
    tid = {}
    for username, name in TEACHERS:
        cur.execute("INSERT INTO users(username,password_hash,full_name,role) VALUES (?,?,?,'teacher')",
                    (username, h("teacher123"), name))
        tid[username] = cur.lastrowid

    gid = {}
    for name, spec, course in GROUPS:
        cur.execute("INSERT INTO groups(name,specialty,course) VALUES (?,?,?)", (name, spec, course))
        gid[name] = cur.lastrowid

    sid = {}
    for username, name, group in STUDENTS:
        cur.execute("INSERT INTO users(username,password_hash,full_name,role) VALUES (?,?,?,'student')",
                    (username, h("student123"), name))
        sid[username] = cur.lastrowid
        cur.execute("INSERT INTO students(user_id,group_id) VALUES (?,?)", (sid[username], gid[group]))

    subj = {}
    for code, name, credits in SUBJECTS:
        cur.execute("INSERT INTO subjects(code,name,credits) VALUES (?,?,?)", (code, name, credits))
        subj[code] = cur.lastrowid

    off = {}
    for code, teacher, group in OFFERINGS:
        cur.execute("INSERT INTO offerings(subject_id,teacher_id,group_id) VALUES (?,?,?)",
                    (subj[code], tid[teacher], gid[group]))
        off[(code, group)] = cur.lastrowid

    for code, group, day, start, end, room, kind in LESSONS:
        cur.execute("""INSERT INTO schedule(offering_id,weekday,start_time,end_time,room,lesson_type)
                       VALUES (?,?,?,?,?,?)""", (off[(code, group)], day, start, end, room, kind))

    for code, group, title, desc, deadline in ASSIGNMENTS:
        cur.execute("INSERT INTO assignments(offering_id,title,description,deadline) VALUES (?,?,?,?)",
                    (off[(code, group)], title, desc, deadline))

    for key, students in GRADES.items():
        for username, marks in students.items():
            for kind, val in zip(("rk1", "rk2", "final"), marks):
                if val is not None:
                    cur.execute("INSERT INTO grades(offering_id,student_id,kind,score) VALUES (?,?,?,?)",
                                (off[key], sid[username], kind, val))
    profiles = {
        "admin": ("", "Жүйе әкімшісі", "admin@platonus.kz"),
        "teacher1": ("Ақпараттық жүйелер кафедрасы", "Доцент, PhD", "a.akhmetova@platonus.kz"),
        "teacher2": ("Бағдарламалық инженерия кафедрасы", "Аға оқытушы", "d.zhussipov@platonus.kz"),
        "teacher3": ("Жалпы білім беру пәндері кафедрасы", "Оқытушы, магистр", "m.orazbaeva@platonus.kz"),
    }
    for username, (dept, pos, mail) in profiles.items():
        cur.execute("UPDATE users SET department=?, position=?, email=? WHERE username=?",
                    (dept, pos, mail, username))
    con.commit()
    con.close()
