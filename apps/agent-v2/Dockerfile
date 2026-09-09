# NetPay Plane — agente v2 (LangGraph + deepagents)
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY knowledge ./knowledge

ENV PYTHONUNBUFFERED=1 \
    KNOWLEDGE_DIR=/app/knowledge \
    AGENT_V2_DATA_DIR=/data/agent-v2

EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python3 -c "import httpx,sys; sys.exit(0 if httpx.get('http://localhost:8010/healthz', timeout=3).status_code==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
