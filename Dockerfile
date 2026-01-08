FROM python:3.11-slim
WORKDIR /workspace
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir --upgrade pip
COPY requirements.txt /workspace/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY . /workspace
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]


