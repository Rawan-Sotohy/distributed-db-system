const express = require("express");
const fetch = require("node-fetch");
const {
  connect, MASTER_ADDR,
  applyCreateDB, applyDropDB, applyCreateTable, applyDeleteTable,
  applyInsert, applyUpdate, applyDelete, applyFullSync,
  selectRecords, searchRecords, listDBs, listTables, getColumns, exportCSV
} = require("./db");

const app = express();
const PORT = process.env.PORT || 8083;
const SLAVE_ADDR = `localhost:${PORT}`;
const masterAddr = process.env.MASTER_ADDR || "localhost:8080";

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Forward write to master
async function forwardToMaster(payload) {
  payload.slave_addr = SLAVE_ADDR;
  const resp = await fetch(`http://${masterAddr}/forward/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return resp.json();
}

app.get("/health", (req, res) => res.json({ status: "ok", role: "slave-node" }));

app.post("/sync", async (req, res) => {
  await applyFullSync(req.body);
  res.json({ status: "synced" });
});

// Replication from master
app.post("/replicate", async (req, res) => {
  const { action, db, table, id, data, columns } = req.body;
  try {
    switch (action) {
      case "create_db":    await applyCreateDB(db); break;
      case "drop_db":      await applyDropDB(db); break;
      case "create_table": await applyCreateTable(db, table, columns); break;
      case "delete_table": await applyDeleteTable(db, table); break;
      case "insert":       await applyInsert(db, table, id, data); break;
      case "update":       await applyUpdate(db, table, id, data); break;
      case "delete":       await applyDelete(db, table, id); break;
    }
    res.json({ status: "applied" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- READ (direct) ---

app.get("/record/select", async (req, res) => {
  try { res.json(await selectRecords(req.query.db, req.query.table)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/record/search", async (req, res) => {
  try { res.json(await searchRecords(req.query.db, req.query.table, req.query.field, req.query.value)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/databases", async (req, res) => res.json(await listDBs()));

app.get("/tables", async (req, res) => {
  try { res.json(await listTables(req.query.db)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/columns", async (req, res) => {
  try { res.json(await getColumns(req.query.db, req.query.table)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/export/csv", async (req, res) => {
  try {
    const csv = await exportCSV(req.query.db, req.query.table);
    res.header("Content-Type", "text/csv");
    res.send(csv);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- WRITE (forward to master) ---

app.post("/record/insert", async (req, res) => {
  try { res.json(await forwardToMaster({ action: "insert", db: req.body.db, table: req.body.table, record: req.body.record })); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.post("/record/update", async (req, res) => {
  try { res.json(await forwardToMaster({ action: "update", db: req.body.db, table: req.body.table, id: req.body.id, updates: req.body.updates })); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.post("/record/delete", async (req, res) => {
  try { res.json(await forwardToMaster({ action: "delete", db: req.body.db, table: req.body.table, id: req.body.id })); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.post("/table/delete", async (req, res) => {
  try { res.json(await forwardToMaster({ action: "delete_table", db: req.body.db, table: req.body.table })); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.post("/db/create", async (req, res) => {
  try { res.json(await forwardToMaster({ action: "create_db", db: req.body.name })); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.post("/table/create", async (req, res) => {
  try { res.json(await forwardToMaster({ action: "create_table", db: req.body.db, table: req.body.table, columns: req.body.columns })); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

// DROP DB — not allowed on slave
app.post("/db/drop", (req, res) => {
  res.status(403).json({ error: "Only Master can drop a database" });
});

connect()
  .then(() => {
    console.log("[SLAVE-NODE] Connected to MySQL");
    app.listen(PORT, () => console.log(`[SLAVE-NODE] Running on port ${PORT}`));
  })
  .catch(err => {
    console.error("[SLAVE-NODE] MySQL connection failed:", err.message);
    process.exit(1);
  });