# ---------------------------------------------------------------------------
# LEO Backend — Production Dockerfile
# Base: Python 3.12 slim for a small image footprint.
# ---------------------------------------------------------------------------

FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies required by some Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies first (layer caching)
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend source
COPY . ./backend

# Set Python path so `backend.xxx` module imports resolve
ENV PYTHONPATH=/app

# Expose the port uvicorn listens on
EXPOSE 8000

# Start the server.
# - host 0.0.0.0    → bind to all interfaces (required inside a container)
# - workers 2       → two worker processes; tune to (2 × CPU cores + 1) in prod
# - timeout-keep-alive 65 → slightly above the Railway/ALB 60s idle timeout
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2 --timeout-keep-alive 65"]
