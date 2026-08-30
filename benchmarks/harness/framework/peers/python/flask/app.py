# flask — the-benchmarker contract (served by gunicorn: app:app)
from flask import Flask

app = Flask(__name__)

@app.get("/")
def root():
    return ""

@app.get("/user/<id>")
def user(id):
    return id

@app.post("/user")
def create():
    return ""
