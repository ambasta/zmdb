// axum — the-benchmarker contract
use axum::{extract::Path, routing::{get, post}, Router};

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(|| async { "" }))
        .route("/user/{id}", get(|Path(id): Path<String>| async move { id }))
        .route("/user", post(|| async { "" }));
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
