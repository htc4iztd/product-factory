FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml ./
COPY pf_agent ./pf_agent
RUN pip install --no-cache-dir .
ENV PYTHONUNBUFFERED=1
EXPOSE 8100
CMD ["uvicorn", "pf_agent.api:app", "--host", "0.0.0.0", "--port", "8100"]
