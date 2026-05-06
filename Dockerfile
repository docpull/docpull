FROM node:20-alpine

# pdfjs-dist needs canvas in some configurations; also install fonts
RUN apk add --no-cache \
    fontconfig \
    freetype \
    ttf-dejavu

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
