FROM python:3.10


WORKDIR /app


COPY . .


RUN pip install -r requirements.txt

RUN pip install -r server/requirements.txt

EXPOSE 8080 29999 8081

CMD python server/service_forest.py & python server/service_tree_gen.py & wait
