FROM --platform=$BUILDPLATFORM node:22.14.0-alpine AS frontend
WORKDIR /frontend
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build
FROM python:3.13.18-slim-trixie@sha256:b7b382eaeb8683a92c6217479b60b59de39514a4ebd6b3cc6ea518c207e22bce AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 STATIC_DIR=/app/static
WORKDIR /app
COPY backend/requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.2 && pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 app
COPY --chown=app:app backend/app ./app
COPY --chown=app:app backend/migrations ./migrations
COPY --chown=app:app backend/alembic.ini .
COPY --from=frontend --chown=app:app /frontend/dist ./static
USER app
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--no-access-log","--no-proxy-headers"]
FROM runtime AS test
USER root
COPY backend/requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY --chown=app:app backend/tests ./tests
COPY --chown=app:app backend/pytest.ini .
USER app
FROM runtime AS production
USER root
RUN python -m pip uninstall --yes pip && python -c "import ensurepip, pathlib, shutil; shutil.rmtree(pathlib.Path(ensurepip.__file__).parent)"
USER app
