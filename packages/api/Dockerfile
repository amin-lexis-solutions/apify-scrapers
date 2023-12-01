FROM node:lts

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn --silent

COPY . ./

RUN yarn prisma:generate

RUN yarn build

RUN echo "$TLS_CA_CERT_MONGO" >ca-mongo.crt

CMD ["bash", "start.sh"]
