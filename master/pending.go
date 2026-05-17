package main

import "sync"

type WriteRequest struct {
	SlaveAddr string `json:"slave_addr"`
	Action    string `json:"action"`
	DB        string `json:"db"`
	Table     string `json:"table"`
	ID        string `json:"id,omitempty"`
	Record    Record `json:"record,omitempty"`
	Updates   Record `json:"updates,omitempty"`
}

var (
	pendingRequests []WriteRequest
	pendingMu       sync.RWMutex
)