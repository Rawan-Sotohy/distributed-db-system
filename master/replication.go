package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

var (
	slaves   []string
	slavesMu sync.RWMutex
)

type ReplicationPayload struct {
	Action  string      `json:"action"`
	DB      string      `json:"db"`
	Table   string      `json:"table,omitempty"`
	ID      string      `json:"id,omitempty"`
	Data    interface{} `json:"data,omitempty"`
	Columns []string    `json:"columns,omitempty"`
}

type ReplicationResult struct {
	Slave   string
	Success bool
	Message string
}

func sendToSlave(addr string, body []byte, resultCh chan<- ReplicationResult) {
	resp, err := http.Post("http://"+addr+"/replicate", "application/json", bytes.NewReader(body))
	if err != nil {
		resultCh <- ReplicationResult{Slave: addr, Success: false, Message: fmt.Sprintf("unreachable: %v", err)}
		return
	}
	defer resp.Body.Close()
	resultCh <- ReplicationResult{Slave: addr, Success: true, Message: fmt.Sprintf("status %d", resp.StatusCode)}
}

func broadcast(payload ReplicationPayload) {
	slavesMu.RLock()
	slavesCopy := make([]string, len(slaves))
	copy(slavesCopy, slaves)
	slavesMu.RUnlock()

	if len(slavesCopy) == 0 { return }

	body, _ := json.Marshal(payload)
	resultCh := make(chan ReplicationResult, len(slavesCopy))

	for _, addr := range slavesCopy {
		go sendToSlave(addr, body, resultCh)
	}

	for i := 0; i < len(slavesCopy); i++ {
		result := <-resultCh
		if result.Success {
			log.Printf("[REPLICATION] ✓ Slave %s → %s", result.Slave, result.Message)
		} else {
			log.Printf("[REPLICATION] ✗ Slave %s → %s", result.Slave, result.Message)
		}
	}
}

func syncSlave(addr string) error {
	snapshot := getFullSnapshot()
	body, _ := json.Marshal(snapshot)
	resp, err := http.Post("http://"+addr+"/sync", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("sync failed: %v", err)
	}
	defer resp.Body.Close()
	return nil
}