// ---- Config ----
const MASTER = "http://10.27.94.49:8080";
const SLAVE_GO = "http://10.27.94.49:8081";
const SLAVE_PY = "http://10.27.94.49:8082";
const SLAVE_NODE = "http://10.27.94.49:8083";

const NODES = [
  { name: "Master (Go)",    addr: MASTER,     role: "master" },
  { name: "Slave 1 (Go)",   addr: SLAVE_GO,   role: "slave-go" },
  { name: "Slave 2 (Py)",   addr: SLAVE_PY,   role: "slave-python" },
  { name: "Slave 3 (Node)", addr: SLAVE_NODE, role: "slave-node" },
];

let currentDB = null;
let currentTable = null;
let currentRole = "master";
let currentNodeAddr = MASTER;

window.onload = async () => {
  await refreshNodes();
  await refreshDBs();
  setInterval(refreshNodes, 5000);
  setInterval(refreshPending, 3000);
};

async function api(url, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

async function refreshNodes() {
  const list = document.getElementById("nodes-list");
  const results = await Promise.all(
    NODES.map(n => fetch(n.addr + "/health").then(r => r.json()).catch(() => null))
  );
  list.innerHTML = NODES.map((n, i) => {
    const up = results[i] !== null;
    const role = results[i]?.role || "";
    const isMaster = role === "master";
    return `<div class="node-item ${isMaster ? "node-master" : ""}" onclick="switchNode('${n.addr}','${role}')">
      <div class="dot ${up ? "" : "down"}"></div>
      ${n.name} ${isMaster ? "👑" : ""}
    </div>`;
  }).join("");
}

function switchNode(addr, role) {
  currentNodeAddr = addr;
  currentRole = role === "master" ? "master" : "slave";
  toast(`Switched to ${role} node`);
  refreshDBs();
  updateUIForRole();
}

function updateUIForRole() {
  const btnDrop = document.getElementById("btn-drop-db");
  if (btnDrop) btnDrop.style.display = currentDB && currentRole === "master" ? "" : "none";
  const btnPending = document.getElementById("btn-pending");
  if (btnPending) btnPending.style.display = currentRole === "master" ? "" : "none";
  const masterBar = document.getElementById("master-bar");
  if (masterBar) masterBar.style.display = currentRole === "master" ? "flex" : "none";
  const btnPulse = document.getElementById("btn-pulse");
  if (btnPulse) btnPulse.style.display = currentRole === "master" ? "" : "none";
}

async function refreshDBs() {
  const dbs = await api(currentNodeAddr + "/databases").catch(() => []);
  const list = document.getElementById("db-list");
  list.innerHTML = (dbs || []).map(db =>
    `<div class="db-item ${db === currentDB ? "active" : ""}" onclick="selectDB('${db}')">${db}</div>`
  ).join("");
}

async function selectDB(name) {
  currentDB = name;
  currentTable = null;
  document.getElementById("current-context").textContent = `📁 ${name}`;
  document.getElementById("btn-create-table").style.display = "";
  document.getElementById("toolbar").style.display = "none";
  document.getElementById("results").innerHTML = "";
  updateUIForRole();
  await refreshDBs();
  await refreshTables();
}

async function refreshTables() {
  const tables = await api(currentNodeAddr + `/tables?db=${currentDB}`).catch(() => []);
  const bar = document.getElementById("tables-bar");
  bar.innerHTML = (tables || []).map(t =>
    `<div class="table-tab ${t === currentTable ? "active" : ""}" onclick="selectTable('${t}')">${t}</div>`
  ).join("");
}

async function selectTable(name) {
  currentTable = name;
  document.getElementById("toolbar").style.display = "";
  await refreshTables();
  await loadRecords();
}

async function loadRecords() {
  if (!currentDB || !currentTable) return;
  const rows = await api(currentNodeAddr + `/record/select?db=${currentDB}&table=${currentTable}`);
  renderTable(rows);
}

function renderTable(rows) {
  const div = document.getElementById("results");
  if (!rows || rows.length === 0) {
    div.innerHTML = `<div class="empty">No records found</div>`; return;
  }
  const cols = Object.keys(rows[0]);
  div.innerHTML = `<table>
    <thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}<th>Actions</th></tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        ${cols.map(c => `<td>${r[c] ?? ""}</td>`).join("")}
        <td>
          <button class="action-btn" onclick='openUpdate(${JSON.stringify(r)})'>Edit</button>
          <button class="action-btn del" onclick="deleteRecord('${r.id}')">Del</button>
        </td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

// ---- Pulse Log ----
async function viewPulseLog() {
  const log = await fetch(MASTER + "/pulse-log").then(r => r.text()).catch(() => "Could not load log");
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  overlay.classList.remove("hidden");
  content.innerHTML = `
    <h3>📋 Pulse Log</h3>
    <pre style="background:#0d1117;padding:12px;border-radius:6px;font-size:11px;color:#22c55e;max-height:400px;overflow-y:auto;white-space:pre-wrap">${log}</pre>
    <div class="modal-actions">
      <button onclick="viewPulseLog()">↻ Refresh</button>
      <button onclick="closeModal()">Close</button>
    </div>`;
}

// ---- Pending Requests ----
async function refreshPending() {
  if (currentRole !== "master") return;
  const pending = await api(MASTER + "/pending").catch(() => []);
  const badge = document.getElementById("pending-badge");
  if (badge) badge.textContent = pending?.length || 0;
}

async function showPending() {
  const pending = await api(MASTER + "/pending").catch(() => []);
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  overlay.classList.remove("hidden");

  if (!pending || pending.length === 0) {
    content.innerHTML = `
      <h3>Pending Write Requests</h3>
      <p style="color:#8b949e;margin-top:12px">No pending requests</p>
      <div class="modal-actions"><button onclick="closeModal()">Close</button></div>`;
    return;
  }

  content.innerHTML = `
    <h3>Pending Write Requests</h3>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;max-height:400px;overflow-y:auto">
      ${pending.map((r, i) => `
        <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px">
          <div style="font-size:12px;color:#8b949e;margin-bottom:6px">From: ${r.slave_addr}</div>
          <div style="font-size:13px;color:#e0e0e0">
            <b>${r.action.toUpperCase()}</b> on <b>${r.db}.${r.table}</b>
            ${r.record ? `<br>Data: ${JSON.stringify(r.record)}` : ""}
            ${r.updates ? `<br>Updates: ${JSON.stringify(r.updates)}` : ""}
            ${r.id ? `<br>ID: ${r.id}` : ""}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="primary" onclick="approveRequest(${i})">✓ Accept</button>
            <button class="danger" onclick="rejectRequest(${i})">✗ Reject</button>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="modal-actions"><button onclick="closeModal()">Close</button></div>`;
}

async function approveRequest(index) {
  await api(MASTER + "/pending/approve", "POST", { index });
  toast("Request approved!");
  await showPending();
}

async function rejectRequest(index) {
  await api(MASTER + "/pending/reject", "POST", { index });
  toast("Request rejected!", true);
  await showPending();
}

// ---- Text to Query ----
async function runPrompt() {
  const prompt = document.getElementById("sql-prompt").value.trim().toLowerCase();
  if (!prompt) return;

  if (prompt.includes("show") || prompt.includes("select") || prompt.includes("all")) {
    await loadRecords();

  } else if (prompt.includes("insert") || prompt.includes("add")) {
    const words = prompt.replace("insert", "").replace("add", "").trim().split(" ");
    const record = {};
    for (let i = 0; i < words.length - 1; i += 2) {
      if (words[i] && words[i+1]) record[words[i]] = words[i+1];
    }
    if (Object.keys(record).length > 0) {
      await api(currentNodeAddr + "/record/insert", "POST", { db: currentDB, table: currentTable, record });
      toast("Inserted!"); await loadRecords();
    } else {
      toast("Format: add field1 value1 field2 value2", true);
    }

  } else if (prompt.includes("delete") || prompt.includes("remove")) {
    const words = prompt.split(" ");
    const id = words[words.length - 1];
    if (id && !isNaN(id)) {
      await api(currentNodeAddr + "/record/delete", "POST", { db: currentDB, table: currentTable, id });
      toast("Deleted!"); await loadRecords();
    } else {
      toast("Format: delete id 1", true);
    }

  } else if (prompt.includes("update")) {
    toast("Format: use Edit button to update", true);

  } else {
    toast("Try: 'show all' / 'add name Ali age 20' / 'delete id 1'", true);
  }

  document.getElementById("sql-prompt").value = "";
}

// ---- Sharding ----
async function openSharding() {
  if (!currentDB || !currentTable) { toast("Select a table first", true); return; }
  const cols = await api(MASTER + `/columns?db=${currentDB}&table=${currentTable}`);
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  overlay.classList.remove("hidden");
  content.innerHTML = `
    <h3>🔀 Sharding — ${currentDB}.${currentTable}</h3>
    <p style="color:#8b949e;font-size:12px;margin-bottom:12px">
      Distribute data across slave nodes based on a key column value.
    </p>
    <label>Shard Key Column</label>
    <select id="shard-key" style="width:100%;padding:8px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e0e0e0;margin-top:4px">
      ${(cols || []).map(c => `<option value="${c}">${c}</option>`).join("")}
    </select>
    <div class="modal-actions">
      <button onclick="closeModal()">Cancel</button>
      <button class="primary" onclick="applyShard()">Apply Sharding</button>
      <button onclick="resetShard()">Reset (Full Sync)</button>
    </div>`;
}

async function applyShard() {
  const key = document.getElementById("shard-key").value;
  const rows = await api(MASTER + `/record/select?db=${currentDB}&table=${currentTable}`);
  if (!rows || rows.error) { toast("Could not fetch data", true); return; }

  const values = [...new Set(rows.map(r => r[key]).filter(Boolean))];
  const slaveAddrs = [SLAVE_GO, SLAVE_PY, SLAVE_NODE];

  for (let i = 0; i < values.length; i++) {
    const slaveAddr = slaveAddrs[i % slaveAddrs.length];
    const shardRows = rows.filter(r => r[key] === values[i]);
    const cols = await api(MASTER + `/columns?db=${currentDB}&table=${currentTable}`);
    await api(slaveAddr + "/table/create", "POST", { db: currentDB, table: currentTable, columns: cols }).catch(() => {});
    for (const row of shardRows) {
      const { id, ...record } = row;
      await api(slaveAddr + "/record/insert", "POST", { db: currentDB, table: currentTable, record }).catch(() => {});
    }
  }

  closeModal();
  toast(`Sharding applied by key: ${key}`);
}

async function resetShard() {
  toast("Full sync sent to all nodes");
  closeModal();
}

// ---- Upload DB ----
function openUpload() {
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  overlay.classList.remove("hidden");
  content.innerHTML = `
    <h3>📤 Upload Database </h3>
    <p style="color:#8b949e;font-size:12px;margin-bottom:12px">
      Upload a file to restore a database.
    </p>
    <input type="file" id="upload-file" accept=".json,.sql" style="color:#e0e0e0;margin-top:8px" />
    <div class="modal-actions">
      <button onclick="closeModal()">Cancel</button>
      <button class="primary" onclick="processUpload()">Upload</button>
    </div>`;
}

async function processUpload() {
  const file = document.getElementById("upload-file").files[0];
  if (!file) { toast("Select a file first", true); return; }
  const text = await file.text();

  try {
    if (file.name.endsWith(".json")) {
      const data = JSON.parse(text);
      const dbName = data.name || file.name.replace(".json", "");
      await api(MASTER + "/db/create", "POST", { name: dbName }).catch(() => {});
      for (const [tableName, tableData] of Object.entries(data.tables || {})) {
        await api(MASTER + "/table/create", "POST", { db: dbName, table: tableName, columns: tableData.columns });
        for (const row of Object.values(tableData.rows || {})) {
          await api(MASTER + "/record/insert", "POST", { db: dbName, table: tableName, record: row });
        }
      }
      closeModal();
      toast(`Database uploaded!`);

    } else if (file.name.endsWith(".sql")) {
      // Get DB name from USE statement or filename
      const useMatch = text.match(/USE\s+`?(\w+)`?/i);
      const dbName = useMatch ? useMatch[1] : file.name.replace(".sql", "").replace(/[^a-zA-Z0-9_]/g, "_");
      await api(MASTER + "/db/create", "POST", { name: dbName }).catch(() => {});

      // Parse CREATE TABLE
      const createMatch = text.match(/CREATE TABLE[^`]*`?(\w+)`?\s*\(([^;]+?)\)\s*ENGINE/is);
      if (createMatch) {
        const tableName = createMatch[1];
        const colDefs = createMatch[2];
        const columns = [];
        for (const line of colDefs.split("\n")) {
          const trimmed = line.trim();
          // Match column definitions (not PRIMARY KEY, INDEX, UNIQUE KEY)
          const colMatch = trimmed.match(/^`(\w+)`\s+(VARCHAR|CHAR|INT|DATE|DECIMAL|ENUM|TEXT)/i);
          if (colMatch && colMatch[1].toLowerCase() !== "id") {
            columns.push(colMatch[1]);
          }
        }
        await api(MASTER + "/table/create", "POST", { db: dbName, table: tableName, columns }).catch(() => {});

        // Parse INSERT rows — each on its own line
        const lines = text.split("\n");
        let inserted = 0;
        const colNames = columns; // already extracted above

        for (const line of lines) {
          const insertMatch = line.match(/^INSERT INTO `?\w+`?\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)/i);
          if (!insertMatch) continue;

          const cols = insertMatch[1].split(",").map(c => c.trim().replace(/`/g, ""));
          const rawVals = insertMatch[2];

          // Parse values carefully (handle commas inside strings)
          const vals = [];
          let current = "";
          let inStr = false;
          for (let i = 0; i < rawVals.length; i++) {
            const ch = rawVals[i];
            if (ch === "'" && rawVals[i-1] !== "\\") {
              inStr = !inStr;
            } else if (ch === "," && !inStr) {
              vals.push(current.trim().replace(/^'|'$/g, "").replace(/\\'/g, "'"));
              current = "";
              continue;
            }
            current += ch;
          }
          vals.push(current.trim().replace(/^'|'$/g, "").replace(/\\'/g, "'"));

          const record = {};
          cols.forEach((col, i) => {
            if (col.toLowerCase() !== "id") record[col] = vals[i] ?? "";
          });

          await api(MASTER + "/record/insert", "POST", { db: dbName, table: tableName, record }).catch(() => {});
          inserted++;

          if (inserted % 100 === 0) toast(`Uploading... ${inserted} rows`);
        }

        closeModal();
        toast(`✅ "${dbName}" uploaded! ${inserted} rows inserted`);
      }
    }

    await refreshDBs();
  } catch (e) {
    toast("Upload failed: " + e.message, true);
  }
}

// ---- Modals ----
let columns = [];

function openModal(type) {
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  overlay.classList.remove("hidden");
  columns = [];

  if (type === "create-db") {
    content.innerHTML = `
      <h3>Create Database</h3>
      <label>Database Name</label>
      <input id="m-db-name" placeholder="e.g. mydb" />
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="createDB()">Create</button>
      </div>`;

  } else if (type === "drop-db") {
    if (currentRole !== "master") {
      content.innerHTML = `
        <h3>Drop Database</h3>
        <p style="color:#ef4444;margin-bottom:8px">⚠️ Only the Master node can drop a database.</p>
        <div class="modal-actions"><button onclick="closeModal()">OK</button></div>`;
      return;
    }
    content.innerHTML = `
      <h3>Drop Database</h3>
      <p style="color:#ef4444;margin-bottom:8px">This will permanently delete <b>${currentDB}</b> and all its data!</p>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="danger" onclick="dropDB()">Drop</button>
      </div>`;

  } else if (type === "create-table") {
    content.innerHTML = `
      <h3>Create Table in <em>${currentDB}</em></h3>
      <label>Table Name</label>
      <input id="m-table-name" placeholder="e.g. users" />
      <label>Columns</label>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="m-col-input" placeholder="Column name" onkeydown="if(event.key==='Enter')addColumn()" />
        <button onclick="addColumn()">Add</button>
      </div>
      <div class="columns-input" id="col-tags"></div>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="createTable()">Create</button>
      </div>`;

  } else if (type === "delete-table") {
    content.innerHTML = `
      <h3>Delete Table</h3>
      <p style="color:#ef4444;margin-bottom:8px">Delete table <b>${currentTable}</b>?</p>
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="danger" onclick="deleteTable()">Delete</button>
      </div>`;

  } else if (type === "insert") {
    fetchColumnsAndShowInsert(); return;

  } else if (type === "search") {
    content.innerHTML = `
      <h3>Search in <em>${currentTable}</em></h3>
      <label>Field</label>
      <input id="m-search-field" placeholder="e.g. name" />
      <label>Value</label>
      <input id="m-search-value" placeholder="search term" />
      <div class="modal-actions">
        <button onclick="closeModal()">Cancel</button>
        <button class="primary" onclick="searchRecords()">Search</button>
      </div>`;
  }
}

async function fetchColumnsAndShowInsert() {
  let cols = await api(currentNodeAddr + `/columns?db=${currentDB}&table=${currentTable}`);
  if (!Array.isArray(cols) || cols.length === 0) cols = ["value"];
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  overlay.classList.remove("hidden");
  content.innerHTML = `
    <h3>Insert into <em>${currentTable}</em></h3>
    ${cols.map(c => `<label>${c}</label><input id="ins_${c}" placeholder="${c}" />`).join("")}
    <div class="modal-actions">
      <button onclick="closeModal()">Cancel</button>
      <button class="primary" onclick="insertRecord([${cols.map(c => `'${c}'`).join(",")}])">Insert</button>
    </div>`;
}

function openUpdate(row) {
  const cols = Object.keys(row).filter(c => c !== "id");
  const content = document.getElementById("modal-content");
  document.getElementById("modal-overlay").classList.remove("hidden");
  content.innerHTML = `
    <h3>Update Record #${row.id}</h3>
    ${cols.map(c => `<label>${c}</label><input id="upd_${c}" value="${row[c] || ""}" />`).join("")}
    <div class="modal-actions">
      <button onclick="closeModal()">Cancel</button>
      <button class="primary" onclick="updateRecord('${row.id}',[${cols.map(c => `'${c}'`).join(",")}])">Update</button>
    </div>`;
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

function addColumn() {
  const input = document.getElementById("m-col-input");
  const val = input.value.trim();
  if (!val) return;
  columns.push(val);
  input.value = "";
  renderColTags();
}

function removeColumn(i) {
  columns.splice(i, 1);
  renderColTags();
}

function renderColTags() {
  document.getElementById("col-tags").innerHTML = columns.map((c, i) =>
    `<div class="col-tag">${c} <span onclick="removeColumn(${i})">✕</span></div>`
  ).join("");
}

// ---- CRUD ----
async function createDB() {
  const name = document.getElementById("m-db-name").value.trim();
  if (!name) return;
  await api(currentNodeAddr + "/db/create", "POST", { name });
  closeModal(); toast("Database created!"); await refreshDBs();
}

async function dropDB() {
  if (currentRole !== "master") {
    toast("Only Master can drop a database!", true);
    closeModal(); return;
  }
  await api(MASTER + "/db/drop", "POST", { name: currentDB });
  currentDB = null; currentTable = null;
  document.getElementById("current-context").textContent = "Select a database";
  document.getElementById("btn-drop-db").style.display = "none";
  document.getElementById("btn-create-table").style.display = "none";
  document.getElementById("tables-bar").innerHTML = "";
  document.getElementById("toolbar").style.display = "none";
  document.getElementById("results").innerHTML = "";
  closeModal(); toast("Database dropped!"); await refreshDBs();
}

async function createTable() {
  const name = document.getElementById("m-table-name").value.trim();
  if (!name || columns.length === 0) { toast("Add a name and at least one column", true); return; }
  await api(currentNodeAddr + "/table/create", "POST", { db: currentDB, table: name, columns });
  closeModal(); toast("Table created!"); await refreshTables();
}

async function deleteTable() {
  await api(currentNodeAddr + "/table/delete", "POST", { db: currentDB, table: currentTable });
  currentTable = null;
  document.getElementById("toolbar").style.display = "none";
  document.getElementById("results").innerHTML = "";
  closeModal(); toast("Table deleted!"); await refreshTables();
}

async function insertRecord(cols) {
  const record = {};
  cols.forEach(c => { record[c] = document.getElementById(`ins_${c}`).value; });
  await api(currentNodeAddr + "/record/insert", "POST", { db: currentDB, table: currentTable, record });
  closeModal(); toast("Record inserted!"); await loadRecords();
}

async function updateRecord(id, cols) {
  const updates = {};
  cols.forEach(c => { updates[c] = document.getElementById(`upd_${c}`).value; });
  await api(currentNodeAddr + "/record/update", "POST", { db: currentDB, table: currentTable, id, updates });
  closeModal(); toast("Record updated!"); await loadRecords();
}

async function deleteRecord(id) {
  await api(currentNodeAddr + "/record/delete", "POST", { db: currentDB, table: currentTable, id });
  toast("Record deleted!"); await loadRecords();
}

async function searchRecords() {
  const field = document.getElementById("m-search-field").value.trim();
  const value = document.getElementById("m-search-value").value.trim();
  const rows = await api(currentNodeAddr + `/record/search?db=${currentDB}&table=${currentTable}&field=${field}&value=${value}`);
  closeModal(); renderTable(rows);
}

// ---- Toast ----
function toast(msg, error = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = error ? "error show" : "show";
  setTimeout(() => t.className = "", 2500);
}