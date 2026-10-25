# IDE（Code-OSS の Web 版）の静的ファイルを配るコンテナ。中身は ide/build.sh が dist/ に作る（ide ワークフローで実行）。
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
