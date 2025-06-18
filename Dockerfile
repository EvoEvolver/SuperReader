# Start from Node.js base image
FROM node:20

# Install Python
RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    apt-get clean

WORKDIR /app

COPY . .


RUN pip install -r requirements.txt

RUN pip install -r server/requirements.txt

RUN cd server && npm install

EXPOSE 8080 8081
RUN npm run --prefix server build

CMD node server/dist/index.js & python server/main.py & wait
