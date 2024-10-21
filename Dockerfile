FROM denoland/deno

EXPOSE 8000

WORKDIR /app

ADD . /app

RUN deno install --entrypoint src/index.tsx

CMD ["run", "--allow-all", "src/index.tsx"]
