FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .
COPY tablero_dh_v2.html .
COPY tablero_fabriles_2026.html .
EXPOSE 3002
CMD ["node", "server.js"]
