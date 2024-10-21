FROM denoland/deno

EXPOSE 8080

WORKDIR /app

ADD . /app

RUN deno install --entrypoint src/index.tsx

CMD ["run", "--allow-all", "src/index.tsx"]
