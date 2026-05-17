import mysql.connector
import threading

_local = threading.local()
MASTER_ADDR = "localhost:8080"

def get_conn():
    if not hasattr(_local, 'conn') or not _local.conn.is_connected():
        _local.conn = mysql.connector.connect(
            host="127.0.0.1",
            user="root",
            password="root123"
        )
    return _local.conn

def execute(query, params=None, fetch=False):
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(query, params or [])
    if fetch:
        cols = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        cursor.close()
        return cols, rows
    conn.commit()
    lastid = cursor.lastrowid
    cursor.close()
    return lastid

SYSTEM_DBS = {"information_schema", "mysql", "performance_schema", "sys"}

# ---------- Apply Replication ----------

def apply_create_db(name):
    execute(f"CREATE DATABASE IF NOT EXISTS `{name}`")

def apply_drop_db(name):
    execute(f"DROP DATABASE IF EXISTS `{name}`")

def apply_create_table(db_name, table_name, columns):
    cols = "id INT AUTO_INCREMENT PRIMARY KEY"
    for c in columns:
        cols += f", `{c}` VARCHAR(255)"
    execute(f"CREATE TABLE IF NOT EXISTS `{db_name}`.`{table_name}` ({cols})")

def apply_delete_table(db_name, table_name):
    execute(f"DROP TABLE IF EXISTS `{db_name}`.`{table_name}`")

def apply_insert(db_name, table_name, record_id, record):
    cols = ", ".join(f"`{k}`" for k in record)
    placeholders = ", ".join(["%s"] * len(record))
    vals = list(record.values())
    execute(
        f"INSERT INTO `{db_name}`.`{table_name}` (id, {cols}) VALUES (%s, {placeholders})",
        [record_id] + vals
    )

def apply_update(db_name, table_name, record_id, updates):
    sets = ", ".join(f"`{k}` = %s" for k in updates)
    vals = list(updates.values()) + [record_id]
    execute(f"UPDATE `{db_name}`.`{table_name}` SET {sets} WHERE id = %s", vals)

def apply_delete(db_name, table_name, record_id):
    execute(f"DELETE FROM `{db_name}`.`{table_name}` WHERE id = %s", [record_id])

def apply_full_sync(snapshot):
    for db_name, tables in snapshot.items():
        apply_create_db(db_name)
        for table_name, table_data in tables.items():
            cols = table_data.get("columns", [])
            apply_create_table(db_name, table_name, cols)
            for row in table_data.get("rows", []):
                rid = row.get("id")
                record = {k: v for k, v in row.items() if k != "id"}
                apply_insert(db_name, table_name, rid, record)

# ---------- Read Operations ----------

def select_records(db_name, table_name):
    try:
        col_names, rows = execute(f"SELECT * FROM `{db_name}`.`{table_name}`", fetch=True)
        return [dict(zip(col_names, [str(v) if v is not None else "" for v in row])) for row in rows], None
    except Exception as e:
        return None, str(e)

def search_records(db_name, table_name, field, value):
    try:
        col_names, rows = execute(
            f"SELECT * FROM `{db_name}`.`{table_name}` WHERE `{field}` LIKE %s",
            [f"%{value}%"], fetch=True
        )
        return [dict(zip(col_names, [str(v) if v is not None else "" for v in row])) for row in rows], None
    except Exception as e:
        return None, str(e)

def list_dbs():
    _, rows = execute("SHOW DATABASES", fetch=True)
    return [r[0] for r in rows if r[0] not in SYSTEM_DBS]

def list_tables(db_name):
    try:
        _, rows = execute(f"SHOW TABLES IN `{db_name}`", fetch=True)
        return [r[0] for r in rows], None
    except Exception as e:
        return None, str(e)

def get_columns(db_name, table_name):
    try:
        _, rows = execute(f"SHOW COLUMNS FROM `{db_name}`.`{table_name}`", fetch=True)
        return [r[0] for r in rows if r[0] != "id"], None
    except Exception as e:
        return None, str(e)

def get_table_stats(db_name, table_name):
    try:
        cols, _ = get_columns(db_name, table_name)
        _, rows = execute(f"SELECT COUNT(*) FROM `{db_name}`.`{table_name}`", fetch=True)
        count = rows[0][0]
        return {"db": db_name, "table": table_name, "row_count": count, "column_count": len(cols), "columns": cols}, None
    except Exception as e:
        return None, str(e)