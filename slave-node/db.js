const mysql = require("mysql2/promise");

let pool;
const MASTER_ADDR = process.env.MASTER_ADDR || "localhost:8080";

async function connect() {
  pool = mysql.createPool({
    host: "127.0.0.1",
    user: "root",
    password: "root123",
    waitForConnections: true,
    connectionLimit: 10,
  });
  await pool.query("SELECT 1");
}

const SYSTEM_DBS = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

// ---------- Apply Replication ----------

async function applyCreateDB(name) {
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``);
}

async function applyDropDB(name) {
  await pool.query(`DROP DATABASE IF EXISTS \`${name}\``);
}

async function applyCreateTable(dbName, tableName, columns) {
  let cols = "id INT AUTO_INCREMENT PRIMARY KEY";
  for (const c of columns) cols += `, \`${c}\` VARCHAR(255)`;
  await pool.query(`CREATE TABLE IF NOT EXISTS \`${dbName}\`.\`${tableName}\` (${cols})`);
}

async function applyDeleteTable(dbName, tableName) {
  await pool.query(`DROP TABLE IF EXISTS \`${dbName}\`.\`${tableName}\``);
}

async function applyInsert(dbName, tableName, id, record) {
  const cols = Object.keys(record).map(k => `\`${k}\``).join(", ");
  const placeholders = Object.keys(record).map(() => "?").join(", ");
  const vals = Object.values(record);
  await pool.query(
    `INSERT INTO \`${dbName}\`.\`${tableName}\` (id, ${cols}) VALUES (?, ${placeholders})`,
    [id, ...vals]
  );
}

async function applyUpdate(dbName, tableName, id, updates) {
  const sets = Object.keys(updates).map(k => `\`${k}\` = ?`).join(", ");
  const vals = [...Object.values(updates), id];
  await pool.query(`UPDATE \`${dbName}\`.\`${tableName}\` SET ${sets} WHERE id = ?`, vals);
}

async function applyDelete(dbName, tableName, id) {
  await pool.query(`DELETE FROM \`${dbName}\`.\`${tableName}\` WHERE id = ?`, [id]);
}

async function applyFullSync(snapshot) {
  for (const [dbName, tables] of Object.entries(snapshot)) {
    await applyCreateDB(dbName);
    for (const [tableName, tableData] of Object.entries(tables)) {
      await applyCreateTable(dbName, tableName, tableData.columns || []);
      for (const row of tableData.rows || []) {
        const { id, ...record } = row;
        await applyInsert(dbName, tableName, id, record);
      }
    }
  }
}

// ---------- Read Operations ----------

async function selectRecords(dbName, tableName) {
  const [rows] = await pool.query(`SELECT * FROM \`${dbName}\`.\`${tableName}\``);
  return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
}

async function searchRecords(dbName, tableName, field, value) {
  const [rows] = await pool.query(
    `SELECT * FROM \`${dbName}\`.\`${tableName}\` WHERE \`${field}\` LIKE ?`,
    [`%${value}%`]
  );
  return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
}

async function listDBs() {
  const [rows] = await pool.query("SHOW DATABASES");
  return rows.map(r => Object.values(r)[0]).filter(n => !SYSTEM_DBS.has(n));
}

async function listTables(dbName) {
  const [rows] = await pool.query(`SHOW TABLES IN \`${dbName}\``);
  return rows.map(r => Object.values(r)[0]);
}

async function getColumns(dbName, tableName) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${dbName}\`.\`${tableName}\``);
  return rows.map(r => r.Field).filter(f => f !== "id");
}

// Special feature: CSV export
async function exportCSV(dbName, tableName) {
  const cols = await getColumns(dbName, tableName);
  const [rows] = await pool.query(`SELECT * FROM \`${dbName}\`.\`${tableName}\``);
  const header = ["id", ...cols].join(",");
  const lines = rows.map(r => ["id", ...cols].map(c => r[c] ?? "").join(","));
  return [header, ...lines].join("\n");
}

module.exports = {
  connect, MASTER_ADDR,
  applyCreateDB, applyDropDB, applyCreateTable, applyDeleteTable,
  applyInsert, applyUpdate, applyDelete, applyFullSync,
  selectRecords, searchRecords, listDBs, listTables, getColumns, exportCSV
};