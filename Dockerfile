FROM oven/bun:1.3.13 AS build

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "start"]
