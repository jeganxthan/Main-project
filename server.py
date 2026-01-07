from fastapi import FastAPI
from ai_engine import run_ai_detection

app = FastAPI(title="FAST CCTV AI Server")

@app.get("/run-ai")
def run_ai():
    """
    Trigger FAST AI detection
    """
    return run_ai_detection()
