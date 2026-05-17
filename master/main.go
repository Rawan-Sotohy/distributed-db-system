package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Connect to MySQL
	if err := connectMySQL(); err != nil {
		log.Fatalf("[MASTER] MySQL connection failed: %v", err)
	}
	log.Println("[MASTER] Connected to MySQL")

	// Start heartbeat — check slaves every 5 seconds
	go startHeartbeat()

	mux := http.NewServeMux()
	setupRoutes(mux)

	log.Printf("[MASTER] Running on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

// startHeartbeat checks all slaves every 5 seconds and logs to pulse.log
func startHeartbeat() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	logFile, err := os.OpenFile("pulse.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Println("[HEARTBEAT] Could not open pulse.log:", err)
		return
	}
	defer logFile.Close()

	logger := log.New(logFile, "", log.LstdFlags)

	for range ticker.C {
		slavesMu.RLock()
		slavesCopy := make([]string, len(slaves))
		copy(slavesCopy, slaves)
		slavesMu.RUnlock()

		// Use channel to collect health results
		type HealthResult struct {
			Addr string
			Up   bool
		}
		resultCh := make(chan HealthResult, len(slavesCopy))

		for _, addr := range slavesCopy {
			go func(addr string) {
				resp, err := http.Get("http://" + addr + "/health")
				if err != nil || resp.StatusCode != 200 {
					resultCh <- HealthResult{Addr: addr, Up: false}
					return
				}
				resp.Body.Close()
				resultCh <- HealthResult{Addr: addr, Up: true}
			}(addr)
		}

		for i := 0; i < len(slavesCopy); i++ {
			r := <-resultCh
			if r.Up {
				logger.Printf("[PULSE] ✓ Slave %s is UP", r.Addr)
				log.Printf("[PULSE] ✓ Slave %s is UP", r.Addr)
			} else {
				logger.Printf("[PULSE] ✗ Slave %s is DOWN", r.Addr)
				log.Printf("[PULSE] ✗ Slave %s is DOWN", r.Addr)
			}
		}
	}
}