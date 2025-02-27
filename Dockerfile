FROM python:3.10


WORKDIR /app


COPY . .


RUN pip install -r requirements.txt

EXPOSE 8080 29999

CMD python -m streamlit run app.py --server.port=8080 --server.address=0.0.0.0 & python server.py & wait
