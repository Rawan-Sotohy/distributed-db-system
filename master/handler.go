package main

import (
	"encoding/json"
	"net/http"
)

func respond(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"error": msg})
}

func setupRoutes(mux *http.ServeMux) {

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]string{"status": "ok", "role": "master"})
	})

	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct{ Address string `json:"address"` }
		json.NewDecoder(r.Body).Decode(&body)
		slavesMu.Lock()
		slaves = append(slaves, body.Address)
		slavesMu.Unlock()
		go syncSlave(body.Address)
		respond(w, 200, map[string]string{"status": "registered"})
	})

	mux.HandleFunc("/slaves", func(w http.ResponseWriter, r *http.Request) {
		slavesMu.RLock()
		defer slavesMu.RUnlock()
		respond(w, 200, slaves)
	})

	mux.HandleFunc("/databases", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		dbs, err := listDBs()
		if err != nil { respondError(w, 500, err.Error()); return }
		respond(w, 200, dbs)
	})

	mux.HandleFunc("/db/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct{ Name string `json:"name"` }
		json.NewDecoder(r.Body).Decode(&body)
		if err := createDB(body.Name); err != nil { respondError(w, 400, err.Error()); return }
		broadcast(ReplicationPayload{Action: "create_db", DB: body.Name})
		respond(w, 200, map[string]string{"status": "created"})
	})

	// --- Drop DB (Master only) ---
	mux.HandleFunc("/db/drop", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct{ Name string `json:"name"` }
		json.NewDecoder(r.Body).Decode(&body)
		if err := dropDB(body.Name); err != nil { respondError(w, 400, err.Error()); return }
		broadcast(ReplicationPayload{Action: "drop_db", DB: body.Name})
		respond(w, 200, map[string]string{"status": "dropped"})
	})

	mux.HandleFunc("/table/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB      string   `json:"db"`
			Table   string   `json:"table"`
			Columns []string `json:"columns"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if err := createTable(body.DB, body.Table, body.Columns); err != nil { respondError(w, 400, err.Error()); return }
		broadcast(ReplicationPayload{Action: "create_table", DB: body.DB, Table: body.Table, Columns: body.Columns})
		respond(w, 200, map[string]string{"status": "table created"})
	})

	mux.HandleFunc("/table/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB    string `json:"db"`
			Table string `json:"table"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if err := deleteTable(body.DB, body.Table); err != nil { respondError(w, 400, err.Error()); return }
		broadcast(ReplicationPayload{Action: "delete_table", DB: body.DB, Table: body.Table})
		respond(w, 200, map[string]string{"status": "table deleted"})
	})

	mux.HandleFunc("/tables", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		tables, err := listTables(r.URL.Query().Get("db"))
		if err != nil { respondError(w, 400, err.Error()); return }
		respond(w, 200, tables)
	})

	mux.HandleFunc("/columns", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		cols, err := getColumns(r.URL.Query().Get("db"), r.URL.Query().Get("table"))
		if err != nil { respondError(w, 400, err.Error()); return }
		respond(w, 200, cols)
	})

	mux.HandleFunc("/record/insert", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB     string `json:"db"`
			Table  string `json:"table"`
			Record Record `json:"record"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		id, err := insertRecord(body.DB, body.Table, body.Record)
		if err != nil { respondError(w, 400, err.Error()); return }
		broadcast(ReplicationPayload{Action: "insert", DB: body.DB, Table: body.Table, ID: id, Data: body.Record})
		respond(w, 200, map[string]string{"status": "inserted", "id": id})
	})

	mux.HandleFunc("/record/select", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		rows, err := selectRecords(r.URL.Query().Get("db"), r.URL.Query().Get("table"))
		if err != nil { respondError(w, 400, err.Error()); return }
		respond(w, 200, rows)
	})

	mux.HandleFunc("/record/search", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		rows, err := searchRecords(
			r.URL.Query().Get("db"), r.URL.Query().Get("table"),
			r.URL.Query().Get("field"), r.URL.Query().Get("value"),
		)
		if err != nil { respondError(w, 400, err.Error()); return }
		respond(w, 200, rows)
	})

	mux.HandleFunc("/record/update", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB      string `json:"db"`
			Table   string `json:"table"`
			ID      string `json:"id"`
			Updates Record `json:"updates"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if err := updateRecord(body.DB, body.Table, body.ID, body.Updates); err != nil { respondError(w, 400, err.Error()); return }
		broadcast(ReplicationPayload{Action: "update", DB: body.DB, Table: body.Table, ID: body.ID, Data: body.Updates})
		respond(w, 200, map[string]string{"status": "updated"})
	})

	mux.HandleFunc("/record/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			DB    string `json:"db"`
			Table string `json:"table"`
			ID    string `json:"id"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if err := deleteRecord(body.DB, body.Table, body.ID); err != nil { respondError(w, 400, err.Error()); return }
		broadcast(ReplicationPayload{Action: "delete", DB: body.DB, Table: body.Table, ID: body.ID})
		respond(w, 200, map[string]string{"status": "deleted"})
	})

	// --- Forward Write Request from Slave ---
	// Slave بيبعت request وMaster بيقبل أو يرفض
	mux.HandleFunc("/forward/write", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct {
			SlaveAddr string      `json:"slave_addr"`
			Action    string      `json:"action"`
			DB        string      `json:"db"`
			Table     string      `json:"table"`
			ID        string      `json:"id,omitempty"`
			Record    Record      `json:"record,omitempty"`
			Updates   Record      `json:"updates,omitempty"`
		}
		json.NewDecoder(r.Body).Decode(&body)

		// Store pending request for GUI to approve/reject
		pendingMu.Lock()
		pendingRequests = append(pendingRequests, body)
		pendingMu.Unlock()

		respond(w, 200, map[string]string{"status": "pending", "message": "Request sent to master for approval"})
	})

	// --- List pending write requests ---
	mux.HandleFunc("/pending", func(w http.ResponseWriter, r *http.Request) {
		pendingMu.RLock()
		defer pendingMu.RUnlock()
		respond(w, 200, pendingRequests)
	})

	// --- Approve pending request ---
	mux.HandleFunc("/pending/approve", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct{ Index int `json:"index"` }
		json.NewDecoder(r.Body).Decode(&body)

		pendingMu.Lock()
		if body.Index >= len(pendingRequests) {
			pendingMu.Unlock()
			respondError(w, 400, "invalid index"); return
		}
		req := pendingRequests[body.Index]
		pendingRequests = append(pendingRequests[:body.Index], pendingRequests[body.Index+1:]...)
		pendingMu.Unlock()

		// Execute the write
		switch req.Action {
		case "insert":
			id, err := insertRecord(req.DB, req.Table, req.Record)
			if err != nil { respondError(w, 400, err.Error()); return }
			broadcast(ReplicationPayload{Action: "insert", DB: req.DB, Table: req.Table, ID: id, Data: req.Record})
		case "update":
			if err := updateRecord(req.DB, req.Table, req.ID, req.Updates); err != nil { respondError(w, 400, err.Error()); return }
			broadcast(ReplicationPayload{Action: "update", DB: req.DB, Table: req.Table, ID: req.ID, Data: req.Updates})
		case "delete":
			if err := deleteRecord(req.DB, req.Table, req.ID); err != nil { respondError(w, 400, err.Error()); return }
			broadcast(ReplicationPayload{Action: "delete", DB: req.DB, Table: req.Table, ID: req.ID})
		case "delete_table":
			if err := deleteTable(req.DB, req.Table); err != nil { respondError(w, 400, err.Error()); return }
			broadcast(ReplicationPayload{Action: "delete_table", DB: req.DB, Table: req.Table})
		}
		respond(w, 200, map[string]string{"status": "approved and executed"})
	})

	// --- Reject pending request ---
	mux.HandleFunc("/pending/reject", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions { respond(w, 200, nil); return }
		var body struct{ Index int `json:"index"` }
		json.NewDecoder(r.Body).Decode(&body)

		pendingMu.Lock()
		if body.Index >= len(pendingRequests) {
			pendingMu.Unlock()
			respondError(w, 400, "invalid index"); return
		}
		pendingRequests = append(pendingRequests[:body.Index], pendingRequests[body.Index+1:]...)
		pendingMu.Unlock()

		respond(w, 200, map[string]string{"status": "rejected"})
	})
}