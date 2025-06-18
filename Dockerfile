# Start from Node.js base image
FROM nikolaik/python-nodejs:python3.10-nodejs24

WORKDIR /app

COPY . .

RUN pip install -r reader/requirements.txt

RUN cd server && npm install

RUN npm run --prefix server build

CMD node server/dist/index.js & gunicorn --workers 1 --threads 4 --bind 0.0.0.0:8080 reader.main:app & wait
