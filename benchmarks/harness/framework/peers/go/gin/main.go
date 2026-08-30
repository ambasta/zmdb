// gin — the-benchmarker contract
package main

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func main() {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.GET("/", func(c *gin.Context) { c.String(http.StatusOK, "") })
	r.GET("/user/:id", func(c *gin.Context) { c.String(http.StatusOK, c.Param("id")) })
	r.POST("/user", func(c *gin.Context) { c.String(http.StatusOK, "") })
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	_ = r.Run(":" + port)
}
