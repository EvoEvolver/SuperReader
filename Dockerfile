# Start from Node.js base image
FROM nikolaik/python-nodejs:python3.10-nodejs24

WORKDIR /app

COPY . .


RUN pip install -r requirements.txt

RUN pip install -r server/requirements.txt

RUN cd server && npm install

EXPOSE 8080 8081
RUN npm run --prefix server build

CMD node server/dist/index.js & python server/main.py & wait
