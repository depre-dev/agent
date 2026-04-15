FROM node:22-bookworm-slim

WORKDIR /app

COPY mcp-server/package*.json ./
RUN npm install --omit=dev

COPY mcp-server/src ./src

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["npm", "run", "start:http"]
