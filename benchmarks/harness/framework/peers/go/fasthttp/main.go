// fasthttp (+ fasthttp/router) — the-benchmarker contract
package main

import (
	"os"

	"github.com/fasthttp/router"
	"github.com/valyala/fasthttp"
)

func main() {
	r := router.New()
	r.GET("/", func(ctx *fasthttp.RequestCtx) {})
	r.GET("/user/{id}", func(ctx *fasthttp.RequestCtx) {
		ctx.WriteString(ctx.UserValue("id").(string))
	})
	r.POST("/user", func(ctx *fasthttp.RequestCtx) {})
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	_ = fasthttp.ListenAndServe(":"+port, r.Handler)
}
