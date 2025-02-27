FROM python:3.10


WORKDIR /app


COPY . .


RUN pip install -r requirements.txt

EXPOSE 8080

EXPOSE 29999

CMD python -m streamlit run app.py --server.port=8080 --server.address=$READER_HOST & python server.py & wait
