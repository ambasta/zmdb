// actix-web — the-benchmarker contract
use actix_web::{get, post, web, App, HttpServer, HttpResponse};

#[get("/")]
async fn root() -> HttpResponse { HttpResponse::Ok().body("") }

#[get("/user/{id}")]
async fn user(id: web::Path<String>) -> HttpResponse { HttpResponse::Ok().body(id.into_inner()) }

#[post("/user")]
async fn create() -> HttpResponse { HttpResponse::Ok().body("") }

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    HttpServer::new(|| App::new().service(root).service(user).service(create))
        .bind(("0.0.0.0", port))?
        .run()
        .await
}
