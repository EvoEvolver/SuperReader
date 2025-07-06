# Start from Node.js base image
FROM nikolaik/python-nodejs:python3.10-nodejs24

WORKDIR /app

COPY . .

RUN pip install -r reader/requirements.txt

RUN cd server && npm install
RUN cd frontend && npm install

RUN npm run --prefix server build
RUN npm run --prefix frontend build

ENV FRONTEND_DIR="/app/frontend/dist/"

CMD node server/dist/index.js & gunicorn --workers 1 --threads 4 --timeout 1000 --bind 0.0.0.0:8080 reader.worker:app -k uvicorn.workers.UvicornWorker & wait
