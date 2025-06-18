FROM python:3.10

WORKDIR /app

COPY . .

RUN pip install -r requirements.txt

RUN pip install -r server/requirements.txt

EXPOSE 8080 8081
RUN npm run --prefix server build

CMD node server/dist/index.js & python server/main.py & wait
