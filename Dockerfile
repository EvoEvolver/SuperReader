FROM python:3.10

WORKDIR /app

COPY . .

# Install Node.js and npm
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs \

RUN pip install -r requirements.txt

RUN pip install -r server/requirements.txt

RUN cd server && npm install

EXPOSE 8080 8081
RUN npm run --prefix server build

CMD node server/dist/index.js & python server/main.py & wait
