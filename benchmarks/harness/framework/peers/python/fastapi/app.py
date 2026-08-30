# fastapi — the-benchmarker contract (served by uvicorn)
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse

app = FastAPI()

@app.get("/", response_class=PlainTextResponse)
def root():
    return ""

@app.get("/user/{id}", response_class=PlainTextResponse)
def user(id: str):
    return id

@app.post("/user", response_class=PlainTextResponse)
def create():
    return ""
