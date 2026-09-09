# NetPay Plane — agente conversacional (FastAPI + OpenRouter)
# Ver docs/11-aia.md.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY knowledge ./knowledge

ENV PYTHONUNBUFFERED=1 \
    KNOWLEDGE_DIR=/app/knowledge \
    AGENT_CHECKPOINT_DIR=/data/checkpoints

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python3 -c "import httpx,sys; sys.exit(0 if httpx.get('http://localhost:8000/healthz', timeout=3).status_code==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
