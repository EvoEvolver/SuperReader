FROM python:3.10


WORKDIR /app


COPY . .


RUN pip install -r requirements.txt

EXPOSE 8080 29999

CMD python -m streamlit run server/service_streamlit.py & python server/service_forest.py & python server/service_tree_gen.py & wait
