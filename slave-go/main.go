package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	if masterAddr == "" {
		masterAddr = "localhost:8080"
	}

	if err := connectMySQL(); err != nil {
		log.Fatalf("[SLAVE-GO] MySQL connection failed: %v", err)
	}
	log.Println("[SLAVE-GO] Connected to MySQL")

	mux := http.NewServeMux()
	setupRoutes(mux)

	log.Printf("[SLAVE-GO] Running on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}