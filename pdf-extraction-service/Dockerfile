FROM python:3.11-slim

# System dependencies for pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpoppler-cpp-dev \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Default: start worker (main process)
# Override with CMD ["uvicorn", "app.main:app", ...] for HTTP-only mode
CMD ["python", "-m", "app.worker"]

EXPOSE 8000
