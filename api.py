import os
import bcrypt
import mysql.connector
from datetime import timedelta
from functools import wraps

from flask import (
    Flask, request, jsonify, session,
    abort, send_from_directory
)

app = Flask(__name__, static_folder='.')
app.secret_key = os.environ.get('SECRET_KEY', 'smartlab-dev-secret')

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=False,   # keep False for local testing on http://127.0.0.1:5000
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
)


def get_db():
    conn = mysql.connector.connect(
        host=os.environ['DB_HOST'],
        port=int(os.environ.get('DB_PORT', 3306)),
        database=os.environ['DB_NAME'],
        user=os.environ['DB_USER'],
        password=os.environ['DB_PASS']
    )
    # FIX: Ensure the DB session uses the same timezone as the user/app
    cur = conn.cursor()
    cur.execute("SET time_zone = 'US/Central'") 
    cur.close()
    return conn


def fetch_one_dict(cur):
    row = cur.fetchone()
    if row is None:
        return None
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, row))


def fetch_all_dict(cur):
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            abort(401)
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    @wraps(f)
    @login_required
    def wrapper(*args, **kwargs):
        db = get_db()
        cur = db.cursor()
        cur.execute("SELECT role FROM Users WHERE user_id = %s", (session['user_id'],))
        row = fetch_one_dict(cur)
        cur.close()
        db.close()

        if not row or row['role'] != 'admin':
            abort(403)
        return f(*args, **kwargs)
    return wrapper

def auto_update_reservation_statuses(cur, db):
    # 1. Auto-complete reservations that have actually passed their end time.
    # We only do this for 'active' or 'approved' reservations.
    cur.execute("""
        UPDATE Reservations 
        SET status = 'completed' 
        WHERE status IN ('approved', 'active') 
          AND end_time <= NOW()
    """)
    
    # 2. Auto-start approved reservations if the start time has arrived.
    # Logic: It must be 'approved', current time is within the window,
    # and we check to make sure it wasn't already marked completed by the query above.
    cur.execute("""
        UPDATE Reservations 
        SET status = 'active' 
        WHERE status = 'approved' 
          AND start_time <= NOW() 
          AND end_time > NOW()
    """)
    db.commit()


# Serve frontend files
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)


# ─────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(force=True)
    email = str(data.get('email', '')).strip().lower()
    pwd = str(data.get('password', ''))

    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT user_id, password_hash, role, first_name, last_name
        FROM Users
        WHERE email = %s
    """, (email,))
    user = fetch_one_dict(cur)
    cur.close()
    db.close()

    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401

    try:
        valid = bcrypt.checkpw(pwd.encode(), user['password_hash'].encode())
    except Exception:
        # fallback only if the row still has a plain test value in password_hash
        valid = (pwd == user['password_hash'])

    if not valid:
        return jsonify({'error': 'Invalid credentials'}), 401

    session.permanent = True
    session['user_id'] = user['user_id']
    session['role'] = user['role']

    return jsonify({
        'user_id': user['user_id'],
        'first_name': user['first_name'],
        'last_name': user['last_name'],
        'role': user['role'],
    })


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json(force=True)

    # 1. Validate Input (Before opening a DB connection)
    required = ['first_name', 'last_name', 'email', 'password', 'role']
    for field in required:
        if not data.get(field):
            return jsonify({'error': f'Missing field: {field}'}), 400

    allowed_roles = {'student', 'professor', 'lab_manager', 'admin'}
    if data['role'] not in allowed_roles:
        return jsonify({'error': 'Invalid role'}), 400

    # 2. Process Data
    email = str(data['email']).strip().lower()
    pwd_hash = bcrypt.hashpw(data['password'].encode(), bcrypt.gensalt(rounds=12)).decode()

    # 3. Database Operations
    db = get_db()
    cur = db.cursor()

    try:
        # Manual check for existing email
        cur.execute("SELECT user_id FROM Users WHERE email = %s", (email,))
        if cur.fetchone():
            return jsonify({'error': 'Email already exists'}), 409

        # Insert new user
        cur.execute("""
            INSERT INTO Users (first_name, last_name, email, password_hash, role, department_id)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            data['first_name'],
            data['last_name'],
            email,
            pwd_hash,
            data['role'],
            data.get('department_id')
        ))
        db.commit()
        user_id = cur.lastrowid
        return jsonify({'user_id': user_id}), 201

    except mysql.connector.errors.IntegrityError as e:
        db.rollback()  # Immediately releases any locks
        if e.errno == 1062:
            return jsonify({'error': 'This email is already registered.'}), 409
        return jsonify({'error': 'Database integrity error.'}), 400

    except Exception as e:
        db.rollback()  # Rollback for any other unexpected errors
        return jsonify({'error': str(e)}), 500

    finally:
        # These lines ALWAYS run, ensuring the connection is never left open
        cur.close()
        db.close()

# ─────────────────────────────────────────────
# DASHBOARD
# ─────────────────────────────────────────────

@app.route('/api/dashboard')
@login_required
def api_dashboard():
    user_id = session['user_id']

    db = get_db()
    cur = db.cursor()

    auto_update_reservation_statuses(cur, db)

    # FIX: Replaced r.end_time >= NOW() with a status check to prevent timezone mismatch bugs
    cur.execute("""
        SELECT r.reservation_id, e.equipment_name, r.start_time, r.end_time, r.status
        FROM Reservations r
        JOIN Equipment e ON r.equipment_id = e.equipment_id
        WHERE r.user_id = %s AND r.status NOT IN ('canceled', 'completed')
        ORDER BY r.start_time
    """, (user_id,))
    reservations = fetch_all_dict(cur)

    cur.execute("""
        SELECT et.type_name, tc.expiration_date
        FROM Training_Certifications tc
        JOIN Equipment_Types et ON tc.equipment_type_id = et.equipment_type_id
        WHERE tc.user_id = %s
          AND tc.expiration_date < DATE_ADD(NOW(), INTERVAL 30 DAY)
    """, (user_id,))
    expiring = fetch_all_dict(cur)

    cur.execute("SELECT COUNT(*) AS total FROM Equipment")
    total = fetch_one_dict(cur)['total']

    cur.execute("SELECT COUNT(*) AS n FROM Equipment WHERE status = 'available'")
    available = fetch_one_dict(cur)['n']

    cur.execute("SELECT COUNT(*) AS n FROM Maintenance_Logs WHERE status = 'open'")
    open_issues = fetch_one_dict(cur)['n']

    cur.close()
    db.close()

    return jsonify({
        'reservations': reservations,
        'expiring_certifications': expiring,
        'stats': {
            'total': total,
            'available': available,
            'open_issues': open_issues,
        }
    })


# ─────────────────────────────────────────────
# LOOKUPS / DROPDOWNS
# ─────────────────────────────────────────────

@app.route('/api/buildings')
@login_required
def api_buildings():
    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT building_id, building_name
        FROM Buildings
        ORDER BY building_name
    """)
    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/departments')
# @login_required
def api_departments():
    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT department_id, department_name, building_id
        FROM Departments
        ORDER BY department_name
    """)
    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/equipment-types')
@login_required
def api_equipment_types():
    db = get_db()
    cur = db.cursor()
    cur.execute("""
        SELECT equipment_type_id, type_name, requires_training
        FROM Equipment_Types
        ORDER BY type_name
    """)
    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


# ─────────────────────────────────────────────
# EQUIPMENT
# ─────────────────────────────────────────────

@app.route('/api/equipment')
@login_required
def api_get_equipment():
    type_id = request.args.get('type_id')
    building_id = request.args.get('building_id')
    search_q = request.args.get('q')

    db = get_db()
    cur = db.cursor()

    conditions = ["e.status NOT IN ('maintenance', 'retired')"]
    params = []

    if type_id:
        conditions.append("e.equipment_type_id = %s")
        params.append(int(type_id))

    if building_id:
        conditions.append("e.building_id = %s")
        params.append(int(building_id))
        
    if search_q:
        conditions.append("(e.equipment_name LIKE %s OR e.serial_number LIKE %s)")
        params.append(f"%{search_q}%")
        params.append(f"%{search_q}%")

    where = " AND ".join(conditions)

    cur.execute(f"""
        SELECT e.equipment_id, e.equipment_name, e.serial_number,
               et.type_name, b.building_name, e.status, e.purchase_date
        FROM Equipment e
        JOIN Equipment_Types et ON e.equipment_type_id = et.equipment_type_id
        JOIN Buildings b ON e.building_id = b.building_id
        WHERE {where}
        ORDER BY e.equipment_name
    """, tuple(params))

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/equipment', methods=['POST'])
@admin_required
def api_add_equipment():
    data = request.get_json(force=True)
    db = get_db()
    cur = db.cursor()

    try:
        cur.execute("""
            INSERT INTO Equipment
                (equipment_name, serial_number, equipment_type_id, building_id, purchase_date, status)
            VALUES (%s, %s, %s, %s, %s, 'available')
        """, (
            data['equipment_name'],
            data['serial_number'],
            int(data['equipment_type_id']),
            int(data['building_id']),
            data['purchase_date'],
        ))
        db.commit()
        return jsonify({'equipment_id': cur.lastrowid}), 201

    except mysql.connector.errors.IntegrityError as e:
        db.rollback() # Immediately unlocks the table
        if e.errno == 1062:
            return jsonify({'error': f"Serial '{data['serial_number']}' already exists."}), 409
        return jsonify({'error': 'Database integrity error'}), 400

    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500

    finally:
        # This block ALWAYS runs, even if there is an error
        cur.close()
        db.close()


@app.route('/api/equipment/<int:equipment_id>/history')
@login_required
def api_equipment_history(equipment_id):
    db = get_db()
    cur = db.cursor()

    cur.execute("""
        SELECT 'reservation' AS event_type, start_time AS event_date, user_id
        FROM Reservations
        WHERE equipment_id = %s

        UNION ALL

        SELECT 'maintenance' AS event_type, reported_date AS event_date, reported_by AS user_id
        FROM Maintenance_Logs
        WHERE equipment_id = %s

        ORDER BY event_date DESC
    """, (equipment_id, equipment_id))

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


# ─────────────────────────────────────────────
# RESERVATIONS
# ─────────────────────────────────────────────

@app.route('/api/reservations')
@login_required
def api_get_reservations():
    status = request.args.get('status')
    search_q = request.args.get('q')
    
    db = get_db()
    cur = db.cursor()

    auto_update_reservation_statuses(cur, db)

    role = session.get('role')

    conditions = []
    params = []

    if role not in ('admin', 'lab_manager'):
        conditions.append("r.user_id = %s")
        params.append(session['user_id'])
        
    if status:
        conditions.append("r.status = %s")
        params.append(status)
        
    if search_q:
        conditions.append("(u.first_name LIKE %s OR u.last_name LIKE %s OR e.equipment_name LIKE %s)")
        params.extend([f"%{search_q}%", f"%{search_q}%", f"%{search_q}%"])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    cur.execute(f"""
        SELECT r.reservation_id,
               CONCAT(u.first_name, ' ', u.last_name) AS user_name,
               e.equipment_name,
               r.start_time, r.end_time, r.status, r.created_at
        FROM Reservations r
        JOIN Users u ON r.user_id = u.user_id
        JOIN Equipment e ON r.equipment_id = e.equipment_id
        {where_clause}
        ORDER BY r.start_time DESC
    """, tuple(params))

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/reservations', methods=['POST'])
@login_required
def api_create_reservation():
    data = request.get_json(force=True)
    user_id = session['user_id']
    equipment_id = int(data['equipment_id'])
    start_time = data['start_time']
    end_time = data['end_time']

    db = get_db()
    cur = db.cursor()

    cur.execute("""
        SELECT equipment_type_id
        FROM Equipment
        WHERE equipment_id = %s
    """, (equipment_id,))
    equip = fetch_one_dict(cur)

    if not equip:
        cur.close()
        db.close()
        return jsonify({'error': 'Equipment not found'}), 404

    cur.execute("""
        SELECT certification_id
        FROM Training_Certifications
        WHERE user_id = %s
          AND equipment_type_id = %s
          AND expiration_date > CURRENT_DATE
    """, (user_id, equip['equipment_type_id']))
    has_training = cur.fetchone()

    if not has_training:
        cur.close()
        db.close()
        return jsonify({'error': 'Training Required'}), 400

    cur.execute("""
        SELECT reservation_id
        FROM Reservations
        WHERE equipment_id = %s
          AND status IN ('approved', 'active')
          AND (%s < end_time AND %s > start_time)
    """, (equipment_id, start_time, end_time))
    conflict = cur.fetchone()

    if conflict:
        cur.close()
        db.close()
        return jsonify({'error': 'Time Unavailable'}), 409

    cur.execute("""
        INSERT INTO Reservations (user_id, equipment_id, start_time, end_time, status)
        VALUES (%s, %s, %s, %s, 'pending')
    """, (user_id, equipment_id, start_time, end_time))
    db.commit()
    reservation_id = cur.lastrowid

    cur.close()
    db.close()
    return jsonify({'reservation_id': reservation_id}), 201


@app.route('/api/reservations/<int:reservation_id>/status', methods=['PATCH'])
@login_required
def api_update_reservation_status(reservation_id):
    data = request.get_json(force=True)
    new_status = data.get('status', '')

    allowed_statuses = {'pending', 'approved', 'active', 'completed', 'canceled'}
    if new_status not in allowed_statuses:
        return jsonify({'error': 'Invalid status'}), 400

    db = get_db()
    cur = db.cursor()

    cur.execute("SELECT user_id FROM Reservations WHERE reservation_id = %s", (reservation_id,))
    res = fetch_one_dict(cur)

    if not res:
        cur.close()
        db.close()
        return jsonify({'error': 'Reservation not found'}), 404

    role = session.get('role')
    user_id = session['user_id']

    # FIX: Allow admins to approve, and allow users to start/complete/cancel their OWN reservations
    if role not in ('admin', 'lab_manager'):
        if new_status == 'approved':
            cur.close()
            db.close()
            abort(403)
        if res['user_id'] != user_id:
            cur.close()
            db.close()
            abort(403)

    cur.execute("UPDATE Reservations SET status = %s WHERE reservation_id = %s", (new_status, reservation_id))
    db.commit()

    cur.close()
    db.close()
    return jsonify({'ok': True})


# ─────────────────────────────────────────────
# MAINTENANCE
# ─────────────────────────────────────────────

@app.route('/api/maintenance')
@login_required
def api_get_maintenance():
    status = request.args.get('status')
    search_q = request.args.get('q')
    
    db = get_db()
    cur = db.cursor()

    conditions = []
    params = []

    if status:
        conditions.append("m.status = %s")
        params.append(status)
        
    if search_q:
        conditions.append("(e.equipment_name LIKE %s OR u.first_name LIKE %s OR u.last_name LIKE %s OR m.issue_description LIKE %s)")
        params.extend([f"%{search_q}%", f"%{search_q}%", f"%{search_q}%", f"%{search_q}%"])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    cur.execute(f"""
        SELECT m.maintenance_id, e.equipment_name,
               CONCAT(u.first_name, ' ', u.last_name) AS reported_by_name,
               m.issue_description, m.reported_date, m.resolved_date, m.status
        FROM Maintenance_Logs m
        JOIN Equipment e ON m.equipment_id = e.equipment_id
        JOIN Users u ON m.reported_by = u.user_id
        {where_clause}
        ORDER BY m.reported_date DESC
    """, tuple(params))

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/maintenance', methods=['POST'])
@login_required
def api_report_issue():
    data = request.get_json(force=True)
    equipment_id = int(data['equipment_id'])
    description = str(data.get('issue_description', '')).strip()
    user_id = session['user_id']

    if not description:
        return jsonify({'error': 'Issue description required'}), 400

    db = get_db()
    cur = db.cursor()

    try:
        cur.execute("""
            INSERT INTO Maintenance_Logs (equipment_id, reported_by, issue_description, status)
            VALUES (%s, %s, %s, 'open')
        """, (equipment_id, user_id, description))
        maintenance_id = cur.lastrowid

        cur.execute("""
            UPDATE Equipment
            SET status = 'maintenance'
            WHERE equipment_id = %s
        """, (equipment_id,))

        cur.execute("""
            UPDATE Reservations
            SET status = 'canceled'
            WHERE equipment_id = %s
              AND status IN ('pending', 'approved')
              AND start_time >= NOW()
        """, (equipment_id,))

        db.commit()
        return jsonify({'maintenance_id': maintenance_id}), 201

    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500

    finally:
        cur.close()
        db.close()


@app.route('/api/maintenance/<int:maintenance_id>/resolve', methods=['PATCH'])
@admin_required
def api_resolve_maintenance(maintenance_id):
    db = get_db()
    cur = db.cursor()

    cur.execute("""
        UPDATE Maintenance_Logs
        SET status = 'resolved', resolved_date = NOW()
        WHERE maintenance_id = %s
    """, (maintenance_id,))

    cur.execute("""
        UPDATE Equipment
        SET status = 'available'
        WHERE equipment_id = (
            SELECT equipment_id
            FROM Maintenance_Logs
            WHERE maintenance_id = %s
        )
    """, (maintenance_id,))

    db.commit()
    cur.close()
    db.close()
    return jsonify({'ok': True})


# ─────────────────────────────────────────────
# CERTIFICATIONS
# ─────────────────────────────────────────────

@app.route('/api/certifications')
@login_required
def api_get_certifications():
    search_q = request.args.get('q')
    
    db = get_db()
    cur = db.cursor()

    conditions = ["tc.user_id = %s"]
    params = [session['user_id']]

    if search_q:
        conditions.append("et.type_name LIKE %s")
        params.append(f"%{search_q}%")

    where_clause = " AND ".join(conditions)

    cur.execute(f"""
        SELECT et.type_name, tc.certification_date, tc.expiration_date
        FROM Training_Certifications tc
        JOIN Equipment_Types et ON tc.equipment_type_id = et.equipment_type_id
        WHERE {where_clause}
        ORDER BY tc.expiration_date
    """, tuple(params))

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/certifications', methods=['POST'])
@admin_required
def api_grant_certification():
    data = request.get_json(force=True)

    db = get_db()
    cur = db.cursor()

    cur.execute("""
        INSERT INTO Training_Certifications
            (user_id, equipment_type_id, certification_date, expiration_date)
        VALUES (%s, %s, %s, %s)
    """, (
        int(data['user_id']),
        int(data['equipment_type_id']),
        data['certification_date'],
        data['expiration_date']
    ))
    db.commit()
    certification_id = cur.lastrowid

    cur.close()
    db.close()
    return jsonify({'certification_id': certification_id}), 201


# ─────────────────────────────────────────────
# USERS
# ─────────────────────────────────────────────

@app.route('/api/users')
@admin_required
def api_users():
    role_filter = request.args.get('role')
    search_q = request.args.get('q')

    db = get_db()
    cur = db.cursor()

    conditions = []
    params = []

    if role_filter:
        conditions.append("u.role = %s")
        params.append(role_filter)

    if search_q:
        conditions.append("(u.first_name LIKE %s OR u.last_name LIKE %s OR u.email LIKE %s OR d.department_name LIKE %s)")
        params.extend([f"%{search_q}%", f"%{search_q}%", f"%{search_q}%", f"%{search_q}%"])

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    cur.execute(f"""
        SELECT u.user_id, u.first_name, u.last_name, u.email, u.role,
               d.department_name, u.created_at
        FROM Users u
        LEFT JOIN Departments d ON u.department_id = d.department_id
        {where_clause}
        ORDER BY u.created_at DESC
    """, tuple(params))

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


# ─────────────────────────────────────────────
# ANALYTICS
# ─────────────────────────────────────────────

@app.route('/api/analytics/utilization')
@admin_required
def api_utilization():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    building_id = request.args.get('building_id')

    if not start_date or not end_date:
        return jsonify({'error': 'start_date and end_date required'}), 400

    db = get_db()
    cur = db.cursor()

    department_id = request.args.get('department_id')

    conditions = ["r.status = 'active'", "r.start_time BETWEEN %s AND %s"]
    params = [start_date, end_date]

    if building_id:
        conditions.append("e.building_id = %s")
        params.append(int(building_id))

    if department_id:                                 # ADD THIS
        conditions.append("u.department_id = %s")     # ADD THIS
        params.append(int(department_id))

    where = " AND ".join(conditions)

    cur.execute(f"""
        SELECT e.equipment_name,
               ROUND(SUM(TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time)) / 60, 2) AS hours_used
        FROM Reservations r
        JOIN Equipment e ON r.equipment_id = e.equipment_id
        JOIN Users u ON r.user_id = u.user_id
        WHERE {where}
        GROUP BY e.equipment_name
        ORDER BY hours_used DESC
    """, tuple(params))

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/analytics/idle')
@admin_required
def api_idle_equipment():
    db = get_db()
    cur = db.cursor()

    cur.execute("""
        SELECT e.equipment_id, e.equipment_name, b.building_name
        FROM Equipment e
        JOIN Buildings b ON e.building_id = b.building_id
        WHERE e.equipment_id NOT IN (
            SELECT DISTINCT equipment_id FROM Reservations
        )
        ORDER BY e.equipment_name
    """)

    rows = fetch_all_dict(cur)
    cur.close()
    db.close()
    return jsonify(rows)


@app.route('/api/analytics/totals')
@admin_required
def api_analytics_totals():
    db = get_db()
    cur = db.cursor()

    cur.execute("SELECT COUNT(*) AS n FROM Users")
    total_users = fetch_one_dict(cur)['n']

    cur.execute("SELECT COUNT(*) AS n FROM Equipment")
    total_equip = fetch_one_dict(cur)['n']

    cur.execute("SELECT COUNT(*) AS n FROM Reservations")
    total_res = fetch_one_dict(cur)['n']

    cur.execute("SELECT COUNT(*) AS n FROM Maintenance_Logs WHERE status = 'open'")
    open_tickets = fetch_one_dict(cur)['n']

    cur.close()
    db.close()
    return jsonify({
        'total_users':   total_users,
        'total_equip':   total_equip,
        'total_res':     total_res,
        'open_tickets':  open_tickets,
    })


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)