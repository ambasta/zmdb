// net/http (stdlib, go1.22+ pattern routing) — the-benchmarker contract
package main

import (
	"net/http"
	"os"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {})
	mux.HandleFunc("GET /user/{id}", func(w http.ResponseWriter, req *http.Request) {
		w.Write([]byte(req.PathValue("id")))
	})
	mux.HandleFunc("POST /user", func(w http.ResponseWriter, _ *http.Request) {})
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	_ = http.ListenAndServe(":"+port, mux)
}
