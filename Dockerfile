FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
