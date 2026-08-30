// chi — the-benchmarker contract
package main

import (
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
)

func main() {
	r := chi.NewRouter()
	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {})
	r.Get("/user/{id}", func(w http.ResponseWriter, req *http.Request) {
		w.Write([]byte(chi.URLParam(req, "id")))
	})
	r.Post("/user", func(w http.ResponseWriter, _ *http.Request) {})
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	_ = http.ListenAndServe(":"+port, r)
}
