FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY scripts ./scripts
ENV PORT=8080
CMD ["node", "server.js"]
