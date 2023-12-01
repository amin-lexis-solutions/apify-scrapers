yarn prisma:generate
yarn build

echo "$TLS_CA_CERT_MONGO" >$PWD/ca-mongo.crt
