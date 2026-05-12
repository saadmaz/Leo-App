# ---------------------------------------------------------------------------
# LEO Backend - Production Dockerfile
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
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full project source (needed for `backend.xxx` imports)
COPY . .

# Set Python path so `backend.xxx` module imports resolve
ENV PYTHONPATH=/app

# Expose the default port (Railway overrides via PORT env var at runtime)
EXPOSE 8000

# Start the server.
# Railway (and Cloud Run) inject a PORT env var - we must bind to it.
# Shell form is required to expand $PORT at runtime.
CMD ["python", "start.py"]
