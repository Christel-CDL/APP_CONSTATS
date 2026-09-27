# Application Constats : serveur Node (contrôle d'accès) + fichiers statiques.
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server/index.cjs ./server/
COPY index.html demarrer.html manifest.webmanifest *.js *.css ./public/
COPY icons/ ./public/icons/
COPY vendor/ ./public/vendor/
# Sauvegarde des constats (photos, textes) : monter un volume Docker sur /data (voir deploy/docker-compose.constats.yml).
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8080 APP_ROOT=/app/public DATA_DIR=/data
USER node
EXPOSE 8080
CMD ["node", "server/index.cjs"]
