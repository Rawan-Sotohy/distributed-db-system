package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

type ReplicationPayload struct {
	Action  string            `json:"action"`
	DB      string            `json:"db"`
	Table   string            `json:"table,omitempty"`
	ID      string            `json:"id,omitempty"`
	Data    map[string]string `json:"data,omitempty"`
	Columns []string          `json:"columns,omitempty"`
}

var masterAddr = os.Getenv("MASTER_ADDR")

func respond(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// forwardToMaster forwards a write request to master for approval
func forwardToMaster(action, db, table, id string, record, updates map[string]string) (map[string]string, error) {
	if masterAddr == "" {
		masterAddr = "localhost:8080"
	}
	body, _ := json.Marshal(map[string]interface{}{
		"slave_addr": fmt.Sprintf("localhost:%s", os.Getenv("PORT")),
		"action":     action,
		"db":         db,
		"table":      table,
		"id":         id,
		"record":     record,
		"updates":    updates,
	})
	resp, err := http.Post("http://"+masterAddr+"/forward/write", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("master unreachable: %v", err)
	}
	defer resp.Body.Close()
	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	return result, nil
}

func setupRoutes(mux *http.ServeMux) {

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]string{"status": "ok", "role": "slave-go"})
	})

	// Full sync from master
	mux.HandleFunc("/sync", func(w http.ResponseWriter, r *http.Request) {
		var snapshot map[string]interface{}
		json.NewDecoder(r.Body).Decode(&snapshot)
		applyFullSync(snapshot)
		respond(w, 200, map[string]string{"status": "synced"})
	})

	// Replication from master
	mux.HandleFunc("/replicate", func(w http.ResponseWriter, r *http.Request) {
		var p ReplicationPayload
		json.NewDecoder(r.Body).Decode(&p)
		switch p.Action {
		case "create_db":    applyCreateDB(p.DB)
		case "drop_db":      applyDropDB(p.DB)
		case "create_table": applyCreateTable(p.DB, p.Table, p.Columns)
		case "delete_table": applyDeleteTable(p.DB, p.Table)
		case "insert":       applyInsert(p.DB, p.Table, p.ID, p.Data)
		case "update":       applyUpdate(p.DB, p.Table, p.ID, p.Data)
		case "delete":       applyDelete(p.DB, p.Table, p.ID)
		}
		respond(w, 200, map[string]string{"status": "applied"})
	})

	// --- READ operations (direct) ---

	mux.HandleFunc("/record/select", func(w http.ResponseWriter, r *http.Request) {
		rows, err := selectRecords(r.URL.Query().Get("db"), r.URL.Query().Get("table"))
		if err != nil { respond(w, 400, map[string]string{"error": err.Error()}); return }
		respond(w, 200, rows)
	})

	mux.HandleFunc("/record/search", func(w http.ResponseWriter, r *http.Request) {
		rows, err := searchRecords(r.URL.Query().Get("db"), r.URL.Query().Get("table"), r.URL.Query().Get("field"), r.URL.Query().Get("value"))
		if err != nil { respond(w, 400, map[string]string{"error": err.Error()}); return }
		respond(w, 200, rows)
	})

	mux.HandleFunc("/databases", func(w http.ResponseWriter, r *http.Request) {
		dbs, _ := listDBs()
		respond(w, 200, dbs)
	})

	mux.HandleFunc("/tables", func(w http.ResponseWriter, r *http.Request) {
		tables, err := listTables(r.URL.Query().Get("db"))
		if err != nil { respond(w, 400, map[string]string{"error": err.Error()}); return }
		respond(w, 200, tables)
	})

	mux.HandleFunc("/columns", func(w http.ResponseWriter, r *http.Request) {
		cols, err := getColumns(r.URL.Query().Get("db"), r.URL.Query().Get("table"))
		if err != nil { respond(w, 400, map[string]string{"error": err.Error()}); return }
		respond(w, 200, cols)
	})

	// --- WRITE operations (forward to master for approval) ---

	mux.HandleFunc("/record/insert", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB     string            `json:"db"`
			Table  string            `json:"table"`
			Record map[string]string `json:"record"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		result, err := forwardToMaster("insert", body.DB, body.Table, "", body.Record, nil)
		if err != nil { respond(w, 503, map[string]string{"error": err.Error()}); return }
		respond(w, 200, result)
	})

	mux.HandleFunc("/record/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB      string            `json:"db"`
			Table   string            `json:"table"`
			ID      string            `json:"id"`
			Updates map[string]string `json:"updates"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		result, err := forwardToMaster("update", body.DB, body.Table, body.ID, nil, body.Updates)
		if err != nil { respond(w, 503, map[string]string{"error": err.Error()}); return }
		respond(w, 200, result)
	})

	mux.HandleFunc("/record/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB    string `json:"db"`
			Table string `json:"table"`
			ID    string `json:"id"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		result, err := forwardToMaster("delete", body.DB, body.Table, body.ID, nil, nil)
		if err != nil { respond(w, 503, map[string]string{"error": err.Error()}); return }
		respond(w, 200, result)
	})

	mux.HandleFunc("/table/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB    string `json:"db"`
			Table string `json:"table"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		result, err := forwardToMaster("delete_table", body.DB, body.Table, "", nil, nil)
		if err != nil { respond(w, 503, map[string]string{"error": err.Error()}); return }
		respond(w, 200, result)
	})

	// DROP DB — not allowed on slave
	mux.HandleFunc("/db/drop", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 403, map[string]string{"error": "Only Master can drop a database"})
	})

	// CREATE operations — forward to master
	mux.HandleFunc("/db/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct{ Name string `json:"name"` }
		json.NewDecoder(r.Body).Decode(&body)
		result, err := forwardToMaster("create_db", body.Name, "", "", nil, nil)
		if err != nil { respond(w, 503, map[string]string{"error": err.Error()}); return }
		respond(w, 200, result)
	})

	mux.HandleFunc("/table/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB      string   `json:"db"`
			Table   string   `json:"table"`
			Columns []string `json:"columns"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		// Forward as JSON directly
		bodyBytes, _ := json.Marshal(map[string]interface{}{
			"slave_addr": fmt.Sprintf("localhost:%s", os.Getenv("PORT")),
			"action":     "create_table",
			"db":         body.DB,
			"table":      body.Table,
			"columns":    body.Columns,
		})
		resp, err := http.Post("http://"+masterAddr+"/forward/write", "application/json", bytes.NewReader(bodyBytes))
		if err != nil { respond(w, 503, map[string]string{"error": "master unreachable"}); return }
		defer resp.Body.Close()
		var result map[string]string
		json.NewDecoder(resp.Body).Decode(&result)
		respond(w, 200, result)
	})
}