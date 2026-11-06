FROM node:22-slim
WORKDIR /app
COPY package.json server.js ./
ENV PORT=8080
CMD ["node", "server.js"]
