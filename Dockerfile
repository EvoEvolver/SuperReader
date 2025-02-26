# 1. 选择基础镜像
FROM python:3.10

# 2. 设置工作目录
WORKDIR /app

# 3. 复制当前目录下的文件到容器
COPY . .

# 4. 安装依赖
RUN pip install -r requirements.txt

# 5. 运行应用
CMD python -m streamlit run app.py && python server.py
